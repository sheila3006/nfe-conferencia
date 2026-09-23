// firebase-init.js
// As chaves abaixo identificam o app (não são secretas); quem protege os dados
// são as regras do Firestore + Auth.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDh24PS7BB0nWLmiF9SljTJes_XuSEoKjM",
  authDomain: "just-burger-nfe.firebaseapp.com",
  projectId: "just-burger-nfe",
  storageBucket: "just-burger-nfe.firebasestorage.app",
  messagingSenderId: "687591009972",
  appId: "1:687591009972:web:fb0e260a709cbaacf9b1e1",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Segunda instância usada só para cadastrar usuários novos sem derrubar
// o login do administrador que está logado.
const authCadastro = getAuth(initializeApp(firebaseConfig, "cadastro-usuarios"));
async function criarLogin(email, senha) {
  const cred = await createUserWithEmailAndPassword(authCadastro, email, senha);
  await signOut(authCadastro);
  return cred.user.uid;
}

export {
  auth, db, criarLogin,
  signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
};
