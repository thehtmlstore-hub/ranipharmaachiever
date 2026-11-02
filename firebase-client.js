import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBkjrapRFFad1FvDbr6_HS-jlEbeSFBPi0",
  authDomain: "ranipharma.firebaseapp.com",
  projectId: "ranipharma",
  storageBucket: "ranipharma.firebasestorage.app",
  messagingSenderId: "424001406592",
  appId: "1:424001406592:web:610167890706f7611d8865"
};

let auth;
let app;
function accountEmail(identifier, role) {
  const id = String(identifier || '').trim().toUpperCase();
  // Use the same mapping in the secure backend when provisioning accounts.
  const safe = id.toLowerCase().replace(/[^a-z0-9]/g, ch => '-' + ch.charCodeAt(0).toString(16));
  return (role === 'faculty' ? 'f-' : 'r-') + safe + (role === 'faculty' ? '@faculty.ranipharmaachievers.com' : '@students.ranipharmaachievers.com');
}
function setMessage(message) {
  const toastText = document.getElementById('toast-text');
  const toast = document.getElementById('toast');
  if (toastText && toast) {
    toastText.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__raniToastTimer);
    window.__raniToastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
  } else alert(message);
}
function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
  button.disabled = busy;
  button.textContent = busy ? 'Signing in…' : button.dataset.originalText;
}
function validateRequired(form) {
  let ok = true;
  form.querySelectorAll('input[required]').forEach(input => {
    const field = input.closest('.field');
    const invalid = !input.value.trim();
    input.setAttribute('aria-invalid', String(invalid));
    field?.classList.toggle('has-error', invalid);
    if (invalid) ok = false;
  });
  if (!ok) form.querySelector('input[aria-invalid="true"]')?.focus();
  return ok;
}
async function login(form, role) {
  if (!validateRequired(form)) return;
  const id = form.querySelector(role === 'student' ? '#reg-no' : '#fac-id')?.value.trim();
  const password = form.querySelector(role === 'student' ? '#student-pw' : '#fac-pw')?.value || '';
  setBusy(form, true);
  try {
    const credential = await signInWithEmailAndPassword(auth, accountEmail(id, role), password);
    const token = await credential.user.getIdToken(true);
    const response = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await signOut(auth);
      throw new Error('The portal backend is not connected to this website deployment. Contact the administrator.');
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 || response.status >= 500) {
      await signOut(auth);
      throw new Error(data.message || 'The portal backend is currently unavailable. Contact the administrator.');
    }
    if (!response.ok) {
      await signOut(auth);
      throw new Error(data.message || 'This account could not be verified. Contact the administrator.');
    }
    if (!data.user || data.user.role !== role) {
      await signOut(auth);
      throw new Error('This account is not authorized for the ' + role + ' portal. Contact the administrator.');
    }
    setMessage('Signed in successfully. Redirecting…');
    window.location.href = role === 'faculty' ? '/faculty' : '/waiting';
  } catch (error) {
    console.error('Rani sign-in error:', error);
    let message = error.message || 'Could not sign in. Please try again.';
    if (['auth/invalid-credential','auth/user-not-found','auth/wrong-password','auth/invalid-email'].includes(error.code)) message = 'Invalid register number / ID or password.';
    if (error.code === 'auth/too-many-requests') message = 'Too many attempts. Please wait a while and try again.';
    if (error.code === 'auth/network-request-failed') message = 'Network error. Check your internet connection.';
    setMessage(message);
  } finally { setBusy(form, false); }
}

export async function initializeRaniFirebase() {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  window.firebaseAuth = auth;
  window.firebaseGetToken = async () => auth.currentUser ? await auth.currentUser.getIdToken() : null;
  window.firebaseSignOut = () => signOut(auth);
  window.firebaseChangePassword = async (currentPassword, newPassword) => {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Please sign in again before changing your password.');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    return true;
  };
  onAuthStateChanged(auth, user => { window.firebaseCurrentUser = user || null; });
  // Wait for Firebase to restore a persisted login before pages start API requests.
  if (typeof auth.authStateReady === 'function') await auth.authStateReady();

  const studentForm = document.querySelector('form[data-role="student"]');
  const facultyForm = document.querySelector('form[data-role="faculty"]');
  studentForm?.addEventListener('submit', event => { event.preventDefault(); login(studentForm, 'student'); });
  facultyForm?.addEventListener('submit', event => { event.preventDefault(); login(facultyForm, 'faculty'); });

  // Secure logout on portal pages. The server verifies tokens on every request;
  // this listener signs out locally when a sign-out control is clicked.
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    try { await signOut(auth); } finally { window.location.href = '/#/signin'; }
  });
  return { app, auth };
}
