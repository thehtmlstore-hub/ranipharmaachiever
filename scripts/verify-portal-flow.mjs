import assert from 'node:assert/strict';
import http from 'node:http';

process.env.GCLOUD_PROJECT = 'demo-ranipharma';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-ranipharma';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const [{ getAuth }, { FieldValue, Timestamp, getFirestore }, { default: handler }] = await Promise.all([
  import('firebase-admin/auth'),
  import('firebase-admin/firestore'),
  import('../lib/portal-api.js')
]);

const auth = getAuth();
const db = getFirestore();
const faculty = { uid: 'qa-faculty', id: 'QA-FAC-001', password: 'FacultyQA!2026' };
const student = { uid: 'qa-student', id: 'QA-STU-001', password: 'StudentQA!2026' };

function accountEmail(identifier, role) {
  const safe = identifier.toUpperCase().toLowerCase().replace(/[^a-z0-9]/g, character => `-${character.charCodeAt(0).toString(16)}`);
  return `${role === 'faculty' ? 'f-' : 'r-'}${safe}@${role === 'faculty' ? 'faculty' : 'students'}.ranipharmaachievers.com`;
}

async function seedUser(user, role, name) {
  const email = accountEmail(user.id, role);
  await auth.createUser({ uid: user.uid, email, password: user.password });
  await db.collection('users').doc(user.uid).set({
    uid: user.uid,
    role,
    active: true,
    name,
    loginCount: 0,
    ...(role === 'faculty' ? { facultyId: user.id } : { regNo: user.id }),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return email;
}

async function signIn(email, password) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data.idToken;
}

const server = http.createServer((req, res) => handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

async function api(token, path, options = {}) {
  const response = await fetch(origin + path, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  assert.equal(response.ok, true, `${response.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  const facultyEmail = await seedUser(faculty, 'faculty', 'QA Faculty');
  const studentEmail = await seedUser(student, 'student', 'QA Student');
  const [facultyToken, studentToken] = await Promise.all([
    signIn(facultyEmail, faculty.password),
    signIn(studentEmail, student.password)
  ]);

  const facultyMe = await api(facultyToken, '/api/auth/me');
  assert.equal(facultyMe.user.role, 'faculty');
  assert.equal(facultyMe.user.id, faculty.id);

  const slotStart = new Date(Date.now() + 30_000).toISOString();
  const created = await api(facultyToken, '/api/faculty/tests', {
    method: 'POST',
    body: {
      name: 'QA One Minute Pharmacy Test',
      slotStart,
      durationMinutes: 1,
      negativeMarks: 1,
      questions: [
        { id: 'q_1', topic: 'Pharmacology', questionText: 'Which is a beta-lactam antibiotic?', options: ['Streptomycin', 'Penicillin G', 'Tetracycline', 'Chloramphenicol'], correctIndex: 1, marks: 4 },
        { id: 'q_2', topic: 'Pharmaceutics', questionText: 'Lyophilization is also called?', options: ['Spray drying', 'Freeze drying', 'Tray drying', 'Fluid-bed drying'], correctIndex: 1, marks: 4 },
        { id: 'q_3', topic: 'Pharmacognosy', questionText: 'Quinine is obtained from?', options: ['Cinchona bark', 'Rauwolfia root', 'Belladonna leaf', 'Ipecac root'], correctIndex: 0, marks: 4 }
      ]
    }
  });
  const testId = created.test.testId;

  const overview = await api(studentToken, '/api/student/overview');
  assert.equal(overview.student.role, 'student');
  assert.equal(overview.nextTest.id, testId);

  const details = await api(studentToken, `/api/student/tests/${testId}`);
  assert.equal(details.unlockOffsetMinutes, 1);
  assert.equal(details.attempt.state, 'none');

  const started = await api(studentToken, `/api/student/tests/${testId}/start`, { method: 'POST' });
  assert.equal(started.questions.length, 3);
  assert.ok(Date.now() < new Date(slotStart).getTime(), 'The early-open test must start before its scheduled time.');

  await api(studentToken, `/api/student/tests/${testId}/answers`, {
    method: 'PUT',
    body: { answers: { q_1: 'B', q_2: 'A' } }
  });
  const submitted = await api(studentToken, `/api/student/tests/${testId}/submit`, {
    method: 'POST',
    body: { answers: { q_1: 'B', q_2: 'A' } }
  });
  assert.equal(submitted.result.score, 3);
  assert.equal(submitted.result.totalPossible, 12);
  assert.equal(submitted.result.correctCount, 1);
  assert.equal(submitted.result.wrongCount, 1);
  assert.equal(submitted.result.unattemptedCount, 1);
  assert.equal(submitted.result.accuracy, 33.3);
  assert.equal(submitted.result.wrongAnswers.length, 1);

  const facultyResults = await api(facultyToken, `/api/faculty/tests/${testId}/results`);
  assert.equal(facultyResults.totalStudents, 1);
  assert.equal(facultyResults.inProgress, 0);
  assert.equal(facultyResults.results.length, 1);
  assert.equal(facultyResults.results[0].regNo, student.id);
  assert.equal(facultyResults.results[0].score, 3);

  const tests = await api(facultyToken, '/api/faculty/tests');
  const summary = tests.tests.find(test => test.testId === testId)?.summary;
  assert.deepEqual(summary, { studentsAttempted: 1, avgScore: 3, highestScore: 3 });

  console.log(JSON.stringify({
    ok: true,
    verified: ['faculty-login', 'student-login', 'one-minute-early-open', 'test-create', 'answer-save', 'submit', 'server-grading', 'faculty-results', 'analytics-summary'],
    score: submitted.result.score,
    totalPossible: submitted.result.totalPossible,
    accuracy: submitted.result.accuracy
  }));
} finally {
  await new Promise(resolve => server.close(resolve));
}
