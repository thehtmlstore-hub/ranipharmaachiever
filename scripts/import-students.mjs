import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function usage() {
  console.error('Usage: node scripts/import-students.mjs <students.json|students.csv> [--validate-only]');
  process.exit(1);
}

function studentEmail(identifier) {
  const id = String(identifier || '').trim().toUpperCase();
  const safe = id.toLowerCase().replace(/[^a-z0-9]/g, character => `-${character.charCodeAt(0).toString(16)}`);
  return `r-${safe}@students.ranipharmaachievers.com`;
}

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(field.trim()); field = '';
    } else field += character;
  }
  fields.push(field.trim());
  return fields;
}

function fromCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map(value => value.trim().toLowerCase().replace(/[ _-]/g, ''));
  const aliases = {
    regNo: ['regno', 'registernumber', 'userid', 'studentid', 'id'],
    name: ['name', 'fullname', 'studentname'],
    password: ['password', 'pass', 'initialpassword']
  };
  // Prefer aliases in the order above. When both a numeric student_id and the
  // real login user_id exist, user_id must be used for authentication.
  const column = key => aliases[key].map(alias => header.indexOf(alias)).find(index => index >= 0) ?? -1;
  const positions = { regNo: column('regNo'), name: column('name'), password: column('password') };
  if (positions.regNo < 0 || positions.name < 0 || positions.password < 0) {
    throw new Error('CSV header must contain register number/user ID, name, and password columns.');
  }
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return { regNo: values[positions.regNo], name: values[positions.name], password: values[positions.password] };
  });
}

function normalize(record) {
  const regNo = String(record.regNo ?? record.registerNumber ?? record.user_id ?? record.studentId ?? '').trim().toUpperCase();
  const name = String(record.name ?? record.fullName ?? record.full_name ?? record.studentName ?? '').trim();
  const password = String(record.password ?? record.initialPassword ?? '');
  if (!/^[A-Z0-9][A-Z0-9\-_/]{2,31}$/.test(regNo)) throw new Error('Invalid register number.');
  if (!name) throw new Error('Name is required.');
  if (password.length < 6) throw new Error('Password must contain at least 6 characters.');
  return { regNo, name, password };
}

const source = process.argv[2];
if (!source) usage();
const validateOnly = process.argv.includes('--validate-only');
const text = await fs.readFile(source, 'utf8');
const extension = path.extname(source).toLowerCase();
const incoming = extension === '.json' ? JSON.parse(text) : fromCsv(text);
if (!Array.isArray(incoming)) throw new Error('JSON source must be an array of student records.');

if (validateOnly) {
  const seenForValidation = new Set();
  const failures = [];
  incoming.forEach((row, index) => {
    try {
      const student = normalize(row);
      if (seenForValidation.has(student.regNo)) throw new Error('Duplicate register number in input file.');
      seenForValidation.add(student.regNo);
    } catch (error) {
      failures.push({ row: index + 2, reason: error.message });
    }
  });
  console.log(JSON.stringify({ source: path.basename(source), total: incoming.length, valid: incoming.length - failures.length, failed: failures }, null, 2));
  if (failures.length) process.exitCode = 2;
  process.exit();
}

const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!rawCredential) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON before running the importer.');
const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(JSON.parse(rawCredential)) });
const auth = getAuth(app);
const db = getFirestore(app);

const seen = new Set();
const report = { source: path.basename(source), total: incoming.length, created: 0, repaired: 0, skipped: 0, failed: [] };
for (let index = 0; index < incoming.length; index += 1) {
  let student;
  try {
    student = normalize(incoming[index]);
    if (seen.has(student.regNo)) throw new Error('Duplicate register number in input file.');
    seen.add(student.regNo);
    const email = studentEmail(student.regNo);
    let user;
    try {
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { displayName: student.name, disabled: false });
      report.repaired += 1;
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      user = await auth.createUser({ email, password: student.password, displayName: student.name, disabled: false });
      report.created += 1;
    }
    const profileRef = db.collection('users').doc(user.uid);
    const profile = await profileRef.get();
    await profileRef.set({
      uid: user.uid,
      role: 'student',
      regNo: student.regNo,
      name: student.name,
      active: true,
      authEmail: email,
      updatedAt: FieldValue.serverTimestamp(),
      ...(profile.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
    }, { merge: true });
  } catch (error) {
    report.failed.push({ row: index + 2, regNo: student?.regNo || incoming[index]?.regNo || '', reason: error.message });
  }
}
report.skipped = report.failed.length;
console.log(JSON.stringify(report, null, 2));
if (report.failed.length) process.exitCode = 2;
