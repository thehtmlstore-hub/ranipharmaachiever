import crypto from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const JSON_LIMIT_BYTES = 1024 * 1024;
const REVIEW_WINDOW_SECONDS = 60;
const START_UNLOCK_MINUTES = 1;
const SUBMIT_GRACE_MS = 2 * 60 * 1000;

function adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return initializeApp();
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
  return initializeApp({ credential: cert(serviceAccount) });
}

const app = adminApp();
const auth = getAuth(app);
const db = getFirestore(app);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(status, error, message) {
  const problem = new Error(message);
  problem.status = status;
  problem.code = error;
  throw problem;
}

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) fail(413, 'payload_too_large', 'Request is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function dateMs(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function iso(value) {
  const milliseconds = dateMs(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function publicUser(profile, uid) {
  const role = profile.role;
  return {
    uid,
    role,
    id: role === 'faculty' ? profile.facultyId : profile.regNo,
    regNo: role === 'student' ? profile.regNo : undefined,
    facultyId: role === 'faculty' ? profile.facultyId : undefined,
    name: profile.name || ''
  };
}

async function requireUser(req, role) {
  const token = bearerToken(req);
  if (!token) fail(401, 'unauthenticated', 'Please sign in to continue.');

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch {
    fail(401, 'unauthenticated', 'Your session is invalid or has expired. Please sign in again.');
  }

  const profileRef = db.collection('users').doc(decoded.uid);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) fail(403, 'profile_missing', 'This login is not linked to an approved portal record.');
  const profile = profileSnap.data();
  if (profile.active !== true) fail(403, 'account_inactive', 'This account is inactive. Contact the administrator.');
  if (!['student', 'faculty'].includes(profile.role)) fail(403, 'forbidden', 'This account has no valid portal role.');
  if (role && profile.role !== role) fail(403, 'forbidden', `This account cannot access the ${role} portal.`);
  if (profile.role === 'student' && !String(profile.regNo || '').trim()) fail(403, 'profile_invalid', 'Student register number is missing.');

  return { decoded, profile, profileRef, user: publicUser(profile, decoded.uid) };
}

async function recordLogin(identity) {
  const authTime = Number(identity.decoded.auth_time || 0);
  const key = crypto.createHash('sha256').update(`${identity.decoded.uid}:${authTime}`).digest('hex');
  const eventRef = db.collection('loginEvents').doc(key);
  await db.runTransaction(async transaction => {
    const event = await transaction.get(eventRef);
    if (event.exists) return;
    transaction.create(eventRef, {
      uid: identity.decoded.uid,
      role: identity.profile.role,
      identifier: identity.user.id,
      signedInAt: authTime ? Timestamp.fromMillis(authTime * 1000) : FieldValue.serverTimestamp(),
      recordedAt: FieldValue.serverTimestamp()
    });
    transaction.set(identity.profileRef, {
      lastLoginAt: FieldValue.serverTimestamp(),
      loginCount: FieldValue.increment(1)
    }, { merge: true });
  });
}

function cleanTest(testId, data) {
  const slotStartMs = dateMs(data.slotStart);
  const durationMinutes = Number(data.durationMinutes || 0);
  const slotEndMs = slotStartMs + durationMinutes * 60 * 1000;
  const questions = Array.isArray(data.questions) ? data.questions : [];
  return {
    id: testId,
    testId,
    name: String(data.name || 'Untitled test'),
    slotStart: new Date(slotStartMs).toISOString(),
    slotEnd: slotEndMs,
    durationMinutes,
    negativeMarks: Number(data.negativeMarks || 0),
    questionCount: questions.length,
    totalMarks: questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
  };
}

function attemptId(uid, testId) {
  return crypto.createHash('sha256').update(`${uid}:${testId}`).digest('hex');
}

function attemptState(data) {
  if (!data) return { state: 'none' };
  return {
    state: data.status === 'submitted' ? 'submitted' : 'in_progress',
    startedAt: iso(data.startedAt),
    submittedAt: iso(data.submittedAt),
    score: data.status === 'submitted' ? Number(data.score || 0) : undefined,
    totalPossible: data.status === 'submitted' ? Number(data.totalPossible || 0) : undefined
  };
}

async function loadTest(testId) {
  const ref = db.collection('tests').doc(testId);
  const snap = await ref.get();
  if (!snap.exists) fail(404, 'not_found', 'Test not found.');
  const data = snap.data();
  const slotStart = dateMs(data.slotStart);
  const duration = Number(data.durationMinutes || 0);
  if (!Number.isFinite(slotStart) || duration <= 0) fail(500, 'invalid_test', 'This test has an invalid schedule.');
  return { ref, snap, data, slotStart, slotEnd: slotStart + duration * 60 * 1000 };
}

function studentQuestions(test) {
  return (Array.isArray(test.questions) ? test.questions : []).map((question, index) => ({
    id: String(question.id || `q_${index + 1}`),
    text: String(question.questionText || ''),
    options: (Array.isArray(question.options) ? question.options : []).map((text, optionIndex) => ({
      key: 'ABCD'[optionIndex],
      text: String(text)
    }))
  }));
}

function validAnswers(input, questions) {
  const allowed = new Map(questions.map((question, index) => [String(question.id || `q_${index + 1}`), true]));
  const output = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  for (const [questionId, answer] of Object.entries(input)) {
    const key = String(answer || '').toUpperCase();
    if (allowed.has(questionId) && /^[A-D]$/.test(key)) output[questionId] = key;
  }
  return output;
}

function grade(testId, test, attempt, answers, now, timedOut) {
  const keys = ['A', 'B', 'C', 'D'];
  let score = 0;
  let totalPossible = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;
  const wrongAnswers = [];
  const topics = new Map();
  const questions = Array.isArray(test.questions) ? test.questions : [];

  questions.forEach((question, index) => {
    const questionId = String(question.id || `q_${index + 1}`);
    const marks = Math.max(0, Number(question.marks || 0));
    const topicName = String(question.topic || '').trim() || 'General';
    if (!topics.has(topicName)) topics.set(topicName, { topic: topicName, correct: 0, total: 0 });
    const topic = topics.get(topicName);
    topic.total += 1;
    totalPossible += marks;
    const chosen = answers[questionId];
    const correctIndex = Number(question.correctIndex);
    const correctKey = keys[correctIndex];
    if (!chosen) {
      unattemptedCount += 1;
      return;
    }
    if (chosen === correctKey) {
      score += marks;
      correctCount += 1;
      topic.correct += 1;
      return;
    }
    wrongCount += 1;
    score -= Math.max(0, Number(test.negativeMarks || 0));
    const chosenIndex = keys.indexOf(chosen);
    wrongAnswers.push({
      number: index + 1,
      text: String(question.questionText || ''),
      yourKey: chosen,
      yourText: String((question.options || [])[chosenIndex] || ''),
      correctKey,
      correctText: String((question.options || [])[correctIndex] || '')
    });
  });

  const startedAt = dateMs(attempt.startedAt);
  const timeTakenSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  return {
    testId,
    testName: String(test.name || 'Test'),
    answers,
    score: Math.max(0, Math.round(score * 100) / 100),
    totalPossible: Math.round(totalPossible * 100) / 100,
    correctCount,
    wrongCount,
    unattemptedCount,
    accuracy: questions.length ? Math.round((correctCount / questions.length) * 1000) / 10 : 0,
    negativeMarks: Math.max(0, Number(test.negativeMarks || 0)),
    topicBreakdown: [...topics.values()],
    wrongAnswers,
    timeTakenSeconds,
    autoSubmitted: Boolean(timedOut)
  };
}

function resultForStudent(attempt, now = Date.now()) {
  const submittedAt = dateMs(attempt.submittedAt);
  const secondsLeft = Number.isFinite(submittedAt)
    ? Math.max(0, REVIEW_WINDOW_SECONDS - Math.floor((now - submittedAt) / 1000))
    : 0;
  return {
    testId: attempt.testId,
    testName: attempt.testName,
    score: Number(attempt.score || 0),
    totalPossible: Number(attempt.totalPossible || 0),
    correctCount: Number(attempt.correctCount || 0),
    wrongCount: Number(attempt.wrongCount || 0),
    unattemptedCount: Number(attempt.unattemptedCount || 0),
    accuracy: Number(attempt.accuracy || 0),
    negativeMarks: Number(attempt.negativeMarks || 0),
    timeTakenSeconds: Number(attempt.timeTakenSeconds || 0),
    autoSubmitted: Boolean(attempt.autoSubmitted),
    reviewSecondsLeft: secondsLeft,
    wrongAnswers: secondsLeft > 0 && Array.isArray(attempt.wrongAnswers) ? attempt.wrongAnswers : []
  };
}

function accountEmail(identifier, role) {
  const id = String(identifier || '').trim().toUpperCase();
  const safe = id.toLowerCase().replace(/[^a-z0-9]/g, character => `-${character.charCodeAt(0).toString(16)}`);
  return `${role === 'faculty' ? 'f-' : 'r-'}${safe}@${role === 'faculty' ? 'faculty' : 'students'}.ranipharmaachievers.com`;
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
}

function cleanQuestion(question, index = 0) {
  const options = Array.isArray(question.options) ? question.options.map(value => String(value || '').trim()) : [];
  const correctIndex = Number(question.correctIndex);
  const marks = Number(question.marks || 0);
  if (!String(question.questionText || '').trim() || options.length !== 4 || options.some(option => !option)) {
    fail(400, 'invalid_question', `Question ${index + 1} must have text and four options.`);
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3 || !Number.isFinite(marks) || marks <= 0) {
    fail(400, 'invalid_question', `Question ${index + 1} needs a correct option and positive marks.`);
  }
  return {
    id: String(question.id || `q_${crypto.randomUUID()}`),
    topic: String(question.topic || '').trim(),
    questionText: String(question.questionText).trim(),
    options,
    correctIndex,
    marks
  };
}

function cleanTestInput(input) {
  const name = String(input.name || '').trim();
  const slotStart = new Date(input.slotStart);
  const durationMinutes = Number(input.durationMinutes);
  const negativeMarks = Number(input.negativeMarks);
  const questions = Array.isArray(input.questions) ? input.questions : [];
  if (!name) fail(400, 'invalid_test', 'Test name is required.');
  if (!Number.isFinite(slotStart.getTime())) fail(400, 'invalid_test', 'Choose a valid test date and time.');
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 24 * 60) fail(400, 'invalid_test', 'Test duration is invalid.');
  if (!Number.isFinite(negativeMarks) || negativeMarks < 0) fail(400, 'invalid_test', 'Negative marks cannot be below zero.');
  if (!questions.length || questions.length > 500) fail(400, 'invalid_test', 'Add between 1 and 500 questions.');
  return {
    name,
    slotStart: Timestamp.fromDate(slotStart),
    durationMinutes,
    negativeMarks,
    questions: questions.map(cleanQuestion)
  };
}

function facultyTest(doc, summary = null) {
  const data = doc.data();
  return {
    testId: doc.id,
    name: data.name,
    slotStart: iso(data.slotStart),
    durationMinutes: Number(data.durationMinutes || 0),
    negativeMarks: Number(data.negativeMarks || 0),
    questions: Array.isArray(data.questions) ? data.questions : [],
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    summary
  };
}

async function deleteQuery(query) {
  while (true) {
    const snap = await query.limit(400).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}

async function facultyTests(req, res) {
  await requireUser(req, 'faculty');
  const [testsSnap, submittedSnap] = await Promise.all([
    db.collection('tests').get(),
    db.collection('attempts').where('status', '==', 'submitted').get()
  ]);
  const grouped = new Map();
  submittedSnap.docs.forEach(doc => {
    const attempt = doc.data();
    if (!grouped.has(attempt.testId)) grouped.set(attempt.testId, []);
    grouped.get(attempt.testId).push(attempt);
  });
  const tests = testsSnap.docs.map(doc => {
    const results = grouped.get(doc.id) || [];
    const summary = results.length ? {
      studentsAttempted: results.length,
      avgScore: Math.round(results.reduce((sum, item) => sum + Number(item.score || 0), 0) / results.length * 10) / 10,
      highestScore: Math.max(...results.map(item => Number(item.score || 0)))
    } : null;
    return facultyTest(doc, summary);
  }).sort((a, b) => new Date(b.slotStart) - new Date(a.slotStart));
  send(res, 200, { tests, serverNow: Date.now() });
}

async function createFacultyTest(req, res) {
  const identity = await requireUser(req, 'faculty');
  const input = cleanTestInput(await bodyJson(req));
  const ref = db.collection('tests').doc();
  await ref.set({
    ...input,
    createdBy: identity.decoded.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  const snap = await ref.get();
  send(res, 201, { test: facultyTest(snap) });
}

async function updateFacultyTest(req, res, testId) {
  await requireUser(req, 'faculty');
  const ref = db.collection('tests').doc(testId);
  const [snap, attempts] = await Promise.all([
    ref.get(),
    db.collection('attempts').where('testId', '==', testId).limit(1).get()
  ]);
  if (!snap.exists) fail(404, 'not_found', 'Test not found.');
  if (Date.now() >= dateMs(snap.data().slotStart) || !attempts.empty) fail(409, 'test_locked', 'A test can only be edited before it starts and before any attempt exists.');
  const input = cleanTestInput(await bodyJson(req));
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() });
  send(res, 200, { test: facultyTest(await ref.get()) });
}

async function deleteFacultyTest(req, res, testId) {
  await requireUser(req, 'faculty');
  const ref = db.collection('tests').doc(testId);
  if (!(await ref.get()).exists) fail(404, 'not_found', 'Test not found.');
  await deleteQuery(db.collection('attempts').where('testId', '==', testId));
  await ref.delete();
  send(res, 200, { ok: true });
}

function facultyResult(attempt) {
  return {
    testId: attempt.testId,
    studentId: attempt.studentId || attempt.regNo,
    regNo: attempt.regNo,
    studentName: attempt.studentName,
    score: Number(attempt.score || 0),
    totalPossible: Number(attempt.totalPossible || 0),
    correctCount: Number(attempt.correctCount || 0),
    wrongCount: Number(attempt.wrongCount || 0),
    unattemptedCount: Number(attempt.unattemptedCount || 0),
    accuracy: Number(attempt.accuracy || 0),
    topicBreakdown: attempt.topicBreakdown || [],
    timeTakenSeconds: Number(attempt.timeTakenSeconds || 0),
    autoSubmitted: Boolean(attempt.autoSubmitted),
    submittedAt: iso(attempt.submittedAt)
  };
}

function compareResults(a, b) {
  return Number(b.score || 0) - Number(a.score || 0)
    || Number(b.accuracy || 0) - Number(a.accuracy || 0)
    || Number(a.timeTakenSeconds || Number.MAX_SAFE_INTEGER) - Number(b.timeTakenSeconds || Number.MAX_SAFE_INTEGER)
    || dateMs(a.submittedAt) - dateMs(b.submittedAt)
    || String(a.regNo || '').localeCompare(String(b.regNo || ''));
}

async function facultyResults(req, res, testId) {
  await requireUser(req, 'faculty');
  if (!(await db.collection('tests').doc(testId).get()).exists) fail(404, 'not_found', 'Test not found.');
  const [attempts, students] = await Promise.all([
    db.collection('attempts').where('testId', '==', testId).get(),
    db.collection('users').where('role', '==', 'student').get()
  ]);
  const results = attempts.docs.filter(doc => doc.data().status === 'submitted').map(doc => facultyResult(doc.data())).sort(compareResults);
  const inProgress = attempts.docs.filter(doc => doc.data().status === 'in_progress').length;
  send(res, 200, { results, inProgress, totalStudents: students.docs.filter(doc => doc.data().active === true).length });
}

async function facultyBank(req, res) {
  await requireUser(req, 'faculty');
  const snap = await db.collection('questionBank').get();
  const questions = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: iso(doc.data().createdAt), updatedAt: iso(doc.data().updatedAt) }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  send(res, 200, { questions });
}

async function addBankQuestions(req, res) {
  const identity = await requireUser(req, 'faculty');
  const input = await bodyJson(req);
  const incoming = Array.isArray(input.questions) ? input.questions : [input];
  if (!incoming.length || incoming.length > 500) fail(400, 'invalid_question', 'Add between 1 and 500 questions.');
  const cleaned = incoming.map(cleanQuestion);
  const batch = db.batch();
  const refs = cleaned.map(question => {
    const ref = db.collection('questionBank').doc();
    batch.set(ref, { ...question, createdBy: identity.decoded.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return ref;
  });
  await batch.commit();
  send(res, 201, { questions: refs.map((ref, index) => ({ id: ref.id, ...cleaned[index] })) });
}

async function updateBankQuestion(req, res, questionId) {
  await requireUser(req, 'faculty');
  const ref = db.collection('questionBank').doc(questionId);
  if (!(await ref.get()).exists) fail(404, 'not_found', 'Question not found.');
  const question = cleanQuestion(await bodyJson(req));
  await ref.update({ ...question, id: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  send(res, 200, { question: { id: ref.id, ...question } });
}

async function deleteBankQuestion(req, res, questionId) {
  await requireUser(req, 'faculty');
  await db.collection('questionBank').doc(questionId).delete();
  send(res, 200, { ok: true });
}

async function facultyStudents(req, res) {
  await requireUser(req, 'faculty');
  const [users, submitted] = await Promise.all([
    db.collection('users').where('role', '==', 'student').get(),
    db.collection('attempts').where('status', '==', 'submitted').get()
  ]);
  const counts = new Map();
  submitted.docs.forEach(doc => counts.set(doc.data().studentUid, (counts.get(doc.data().studentUid) || 0) + 1));
  const students = users.docs.map(doc => {
    const data = doc.data();
    return {
      uid: doc.id,
      regNo: data.regNo,
      name: data.name,
      active: data.active === true,
      testsTaken: counts.get(doc.id) || 0,
      createdAt: iso(data.createdAt),
      lastLoginAt: iso(data.lastLoginAt),
      loginCount: Number(data.loginCount || 0)
    };
  }).sort((a, b) => String(a.regNo).localeCompare(String(b.regNo)));
  send(res, 200, { students });
}

async function createStudents(req, res) {
  await requireUser(req, 'faculty');
  const input = await bodyJson(req);
  const rows = Array.isArray(input.students) ? input.students : [];
  if (!rows.length || rows.length > 500) fail(400, 'invalid_students', 'Add between 1 and 500 students at a time.');
  const created = [];
  const skipped = [];
  const seen = new Set();
  for (const row of rows) {
    const regNo = String(row.regNo || '').trim().toUpperCase();
    const name = String(row.name || '').trim();
    const label = regNo || '(blank)';
    const password = row.password ? String(row.password) : randomPassword();
    if (!/^[A-Z0-9][A-Z0-9\-_/]{2,31}$/.test(regNo)) { skipped.push({ regNo: label, reason: 'Register number must be 3–32 letters, numbers, dashes, underscores or slashes.' }); continue; }
    if (!name) { skipped.push({ regNo: label, reason: 'Name is required.' }); continue; }
    if (password.length < 6) { skipped.push({ regNo: label, reason: 'Password must be at least 6 characters.' }); continue; }
    if (seen.has(regNo)) { skipped.push({ regNo: label, reason: 'Duplicate in this import.' }); continue; }
    seen.add(regNo);
    const email = accountEmail(regNo, 'student');
    let user;
    try {
      user = await auth.createUser({ email, password, displayName: name, disabled: false });
      await db.collection('users').doc(user.uid).set({
        uid: user.uid,
        role: 'student',
        regNo,
        name,
        active: true,
        authEmail: email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      created.push({ regNo, name, password });
    } catch (error) {
      if (user?.uid) await auth.deleteUser(user.uid).catch(() => {});
      const reason = error.code === 'auth/email-already-exists' ? 'Student already exists.' : 'Could not create this student.';
      skipped.push({ regNo, reason });
    }
  }
  send(res, 200, { created, skipped });
}

async function findStudent(regNo) {
  const normalized = String(regNo || '').trim().toUpperCase();
  const snap = await db.collection('users').where('regNo', '==', normalized).limit(1).get();
  if (snap.empty || snap.docs[0].data().role !== 'student') fail(404, 'not_found', 'Student not found.');
  return { regNo: normalized, ref: snap.docs[0].ref, uid: snap.docs[0].id, data: snap.docs[0].data() };
}

async function resetStudentPassword(req, res, regNo) {
  await requireUser(req, 'faculty');
  const student = await findStudent(regNo);
  const input = await bodyJson(req);
  const password = input.password ? String(input.password) : randomPassword();
  if (password.length < 6) fail(400, 'weak_password', 'Password must be at least 6 characters.');
  await auth.updateUser(student.uid, { password, disabled: false });
  await auth.revokeRefreshTokens(student.uid);
  await student.ref.set({ active: true, passwordResetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  send(res, 200, { regNo: student.regNo, password });
}

async function deleteStudent(req, res, regNo) {
  await requireUser(req, 'faculty');
  const student = await findStudent(regNo);
  await auth.deleteUser(student.uid).catch(error => {
    if (error.code !== 'auth/user-not-found') throw error;
  });
  await deleteQuery(db.collection('attempts').where('studentUid', '==', student.uid));
  await deleteQuery(db.collection('loginEvents').where('uid', '==', student.uid));
  await student.ref.delete();
  send(res, 200, { ok: true });
}

async function authMe(req, res) {
  const identity = await requireUser(req);
  await recordLogin(identity);
  send(res, 200, { user: identity.user });
}

async function studentOverview(req, res) {
  const identity = await requireUser(req, 'student');
  const now = Date.now();
  const [testsSnap, attemptsSnap] = await Promise.all([
    db.collection('tests').get(),
    db.collection('attempts').where('studentUid', '==', identity.decoded.uid).get()
  ]);
  const attempts = new Map(attemptsSnap.docs.map(doc => [doc.data().testId, doc.data()]));
  const tests = testsSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(test => {
      const start = dateMs(test.slotStart);
      const end = start + Number(test.durationMinutes || 0) * 60 * 1000;
      const attempt = attempts.get(test.id);
      return Number.isFinite(start) && (end > now || attempt?.status === 'in_progress');
    })
    .sort((a, b) => dateMs(a.slotStart) - dateMs(b.slotStart));
  const next = tests[0];
  send(res, 200, {
    student: identity.user,
    nextTest: next ? cleanTest(next.id, next) : null,
    serverNow: now
  });
}

async function studentTestDetails(req, res, testId) {
  const identity = await requireUser(req, 'student');
  const test = await loadTest(testId);
  const attemptSnap = await db.collection('attempts').doc(attemptId(identity.decoded.uid, testId)).get();
  send(res, 200, {
    student: identity.user,
    test: cleanTest(testId, test.data),
    attempt: attemptState(attemptSnap.exists ? attemptSnap.data() : null),
    unlockOffsetMinutes: START_UNLOCK_MINUTES,
    serverNow: Date.now()
  });
}

async function startTest(req, res, testId) {
  const identity = await requireUser(req, 'student');
  const test = await loadTest(testId);
  const now = Date.now();
  if (now < test.slotStart) fail(409, 'not_open', 'This test has not started yet.');
  if (now >= test.slotEnd) fail(409, 'closed', 'This test slot has ended.');

  const ref = db.collection('attempts').doc(attemptId(identity.decoded.uid, testId));
  let saved;
  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (snap.exists) {
      saved = snap.data();
      if (saved.status === 'submitted') fail(409, 'already_submitted', 'You have already submitted this test.');
      return;
    }
    saved = {
      studentUid: identity.decoded.uid,
      studentId: identity.user.regNo,
      regNo: identity.user.regNo,
      studentName: identity.user.name,
      testId,
      testName: test.data.name || 'Test',
      status: 'in_progress',
      answers: {},
      startedAt: Timestamp.fromMillis(now),
      lastSavedAt: Timestamp.fromMillis(now)
    };
    transaction.create(ref, saved);
  });

  send(res, 200, {
    student: identity.user,
    test: { id: testId, name: String(test.data.name || 'Test'), durationMinutes: Number(test.data.durationMinutes || 0) },
    questions: studentQuestions(test.data),
    answers: validAnswers(saved.answers, test.data.questions || []),
    deadline: test.slotEnd,
    serverNow: now
  });
}

async function saveAnswers(req, res, testId) {
  const identity = await requireUser(req, 'student');
  const test = await loadTest(testId);
  const input = await bodyJson(req);
  const answers = validAnswers(input.answers, test.data.questions || []);
  const ref = db.collection('attempts').doc(attemptId(identity.decoded.uid, testId));
  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists) fail(409, 'not_started', 'Start the test before saving answers.');
    if (snap.data().status === 'submitted') fail(409, 'already_submitted', 'This test is already submitted.');
    transaction.update(ref, { answers, lastSavedAt: FieldValue.serverTimestamp() });
  });
  send(res, 200, { ok: true, saved: Object.keys(answers).length });
}

async function submitTest(req, res, testId) {
  const identity = await requireUser(req, 'student');
  const test = await loadTest(testId);
  const input = await bodyJson(req);
  const now = Date.now();
  if (now > test.slotEnd + SUBMIT_GRACE_MS) fail(409, 'closed', 'The submission window has closed. Contact your faculty if you need help.');
  const ref = db.collection('attempts').doc(attemptId(identity.decoded.uid, testId));
  let completed;
  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists) fail(409, 'not_started', 'Start the test before submitting.');
    const existing = snap.data();
    if (existing.status === 'submitted') {
      completed = existing;
      return;
    }
    const answers = validAnswers(input.answers || existing.answers, test.data.questions || []);
    const graded = grade(testId, test.data, existing, answers, now, input.timedOut || now >= test.slotEnd);
    completed = {
      ...existing,
      ...graded,
      status: 'submitted',
      submittedAt: Timestamp.fromMillis(now),
      lastSavedAt: Timestamp.fromMillis(now)
    };
    transaction.set(ref, completed);
  });
  send(res, 200, { result: resultForStudent(completed, now) });
}

async function getResult(req, res, testId) {
  const identity = await requireUser(req, 'student');
  const snap = await db.collection('attempts').doc(attemptId(identity.decoded.uid, testId)).get();
  if (!snap.exists || snap.data().status !== 'submitted') fail(404, 'not_found', 'No submitted result was found.');
  send(res, 200, { result: resultForStudent(snap.data()) });
}

function routePath(req) {
  return new URL(req.url, 'http://localhost').pathname.replace(/^\/api/, '') || '/';
}

export default async function handler(req, res) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const path = routePath(req);
    if (method === 'OPTIONS') return send(res, 204, {});
    if (method === 'GET' && path === '/auth/me') return await authMe(req, res);
    if (method === 'GET' && path === '/student/overview') return await studentOverview(req, res);

    if (method === 'GET' && path === '/faculty/tests') return await facultyTests(req, res);
    if (method === 'POST' && path === '/faculty/tests') return await createFacultyTest(req, res);
    if (method === 'GET' && path === '/faculty/bank') return await facultyBank(req, res);
    if (method === 'POST' && path === '/faculty/bank') return await addBankQuestions(req, res);
    if (method === 'GET' && path === '/faculty/students') return await facultyStudents(req, res);
    if (method === 'POST' && path === '/faculty/students') return await createStudents(req, res);

    let facultyMatch = path.match(/^\/faculty\/tests\/([^/]+)\/results$/);
    if (method === 'GET' && facultyMatch) return await facultyResults(req, res, decodeURIComponent(facultyMatch[1]));
    facultyMatch = path.match(/^\/faculty\/tests\/([^/]+)$/);
    if (facultyMatch) {
      const testId = decodeURIComponent(facultyMatch[1]);
      if (method === 'PUT') return await updateFacultyTest(req, res, testId);
      if (method === 'DELETE') return await deleteFacultyTest(req, res, testId);
    }
    facultyMatch = path.match(/^\/faculty\/bank\/([^/]+)$/);
    if (facultyMatch) {
      const questionId = decodeURIComponent(facultyMatch[1]);
      if (method === 'PUT') return await updateBankQuestion(req, res, questionId);
      if (method === 'DELETE') return await deleteBankQuestion(req, res, questionId);
    }
    facultyMatch = path.match(/^\/faculty\/students\/([^/]+)\/password$/);
    if (method === 'PUT' && facultyMatch) return await resetStudentPassword(req, res, decodeURIComponent(facultyMatch[1]));
    facultyMatch = path.match(/^\/faculty\/students\/([^/]+)$/);
    if (method === 'DELETE' && facultyMatch) return await deleteStudent(req, res, decodeURIComponent(facultyMatch[1]));

    let match = path.match(/^\/student\/tests\/([^/]+)$/);
    if (method === 'GET' && match) return await studentTestDetails(req, res, decodeURIComponent(match[1]));
    match = path.match(/^\/student\/tests\/([^/]+)\/(start|answers|submit|result)$/);
    if (match) {
      const testId = decodeURIComponent(match[1]);
      const action = match[2];
      if (method === 'POST' && action === 'start') return await startTest(req, res, testId);
      if (method === 'PUT' && action === 'answers') return await saveAnswers(req, res, testId);
      if (method === 'POST' && action === 'submit') return await submitTest(req, res, testId);
      if (method === 'GET' && action === 'result') return await getResult(req, res, testId);
    }
    fail(404, 'not_found', 'API route not found.');
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('Rani portal API error:', error);
    const code = error.code || 'server_error';
    const message = status >= 500 ? 'The portal server could not complete this request.' : error.message;
    send(res, status, { error: code, message });
  }
}
