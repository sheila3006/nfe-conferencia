// firebase-init.js
// As chaves abaixo identificam o app (não são secretas); quem protege os dados
// são as regras do Firestore + Auth.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
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

export {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  collection, doc, setDoc, getDoc, getDocs, updateDoc,
  query, orderBy, serverTimestamp,
};
