import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { S3_PRESIGN_API_URL, firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let isSignupMode = false;
let unsubscribeNotes = null;
let currentNotes = [];

const authView = document.querySelector("#auth-view");
const notesView = document.querySelector("#notes-view");
const authForm = document.querySelector("#auth-form");
const authTitle = document.querySelector("#auth-title");
const authSubtitle = document.querySelector("#auth-subtitle");
const authSubmit = document.querySelector("#auth-submit");
const toggleAuth = document.querySelector("#toggle-auth");
const authMessage = document.querySelector("#auth-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const userEmail = document.querySelector("#user-email");
const logoutButton = document.querySelector("#logout-button");

const noteForm = document.querySelector("#note-form");
const noteIdInput = document.querySelector("#note-id");
const noteTitleInput = document.querySelector("#note-title");
const noteContentInput = document.querySelector("#note-content");
const attachmentInput = document.querySelector("#attachment");
const attachmentHint = document.querySelector("#attachment-hint");
const noteMessage = document.querySelector("#note-message");
const saveNoteButton = document.querySelector("#save-note");
const resetFormButton = document.querySelector("#reset-form");
const editorTitle = document.querySelector("#editor-title");
const notesList = document.querySelector("#notes-list");
const emptyState = document.querySelector("#empty-state");
const notesCount = document.querySelector("#notes-count");
const noteTemplate = document.querySelector("#note-template");

toggleAuth.addEventListener("click", () => {
  isSignupMode = !isSignupMode;
  authTitle.textContent = isSignupMode ? "Create account" : "Sign in";
  authSubtitle.textContent = isSignupMode
    ? "Create a Firebase Auth account to start saving notes."
    : "Use your account to manage cloud notes.";
  authSubmit.textContent = isSignupMode ? "Sign up" : "Sign in";
  toggleAuth.textContent = isSignupMode ? "Already have an account" : "Create a new account";
  setMessage(authMessage, "");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(authMessage, "");
  authSubmit.disabled = true;

  try {
    if (isSignupMode) {
      await createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
    } else {
      await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
    }
    authForm.reset();
  } catch (error) {
    setMessage(authMessage, readableFirebaseError(error), "error");
  } finally {
    authSubmit.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
});

noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = auth.currentUser;
  if (!user) {
    setMessage(noteMessage, "Please sign in first.", "error");
    return;
  }

  saveNoteButton.disabled = true;
  setMessage(noteMessage, "Saving note...");

  try {
    let attachment = null;
    const file = attachmentInput.files[0];

    if (file) {
      setMessage(noteMessage, "Uploading attachment to AWS S3...");
      attachment = await uploadAttachmentToS3(file, user.uid);
    }

    const noteData = {
      title: noteTitleInput.value.trim(),
      content: noteContentInput.value.trim(),
      updatedAt: serverTimestamp()
    };

    if (attachment) {
      noteData.attachment = attachment;
    }

    const existingNoteId = noteIdInput.value;

    if (existingNoteId) {
      await updateDoc(noteDocRef(user.uid, existingNoteId), noteData);
      setMessage(noteMessage, "Note updated successfully.", "success");
    } else {
      await addDoc(notesCollectionRef(user.uid), {
        ...noteData,
        createdAt: serverTimestamp()
      });
      setMessage(noteMessage, "Note created successfully.", "success");
    }

    resetNoteForm();
  } catch (error) {
    setMessage(noteMessage, error.message || "Could not save note.", "error");
  } finally {
    saveNoteButton.disabled = false;
  }
});

resetFormButton.addEventListener("click", resetNoteForm);

onAuthStateChanged(auth, (user) => {
  if (unsubscribeNotes) {
    unsubscribeNotes();
    unsubscribeNotes = null;
  }

  if (!user) {
    authView.classList.remove("hidden");
    notesView.classList.add("hidden");
    userEmail.textContent = "";
    currentNotes = [];
    renderNotes();
    return;
  }

  authView.classList.add("hidden");
  notesView.classList.remove("hidden");
  userEmail.textContent = user.email;
  listenToNotes(user.uid);
});

function listenToNotes(userId) {
  const notesQuery = query(notesCollectionRef(userId), orderBy("updatedAt", "desc"));

  unsubscribeNotes = onSnapshot(notesQuery, (snapshot) => {
    currentNotes = snapshot.docs.map((noteDoc) => ({
      id: noteDoc.id,
      ...noteDoc.data()
    }));
    renderNotes();
  }, (error) => {
    setMessage(noteMessage, readableFirebaseError(error), "error");
  });
}

function renderNotes() {
  notesList.innerHTML = "";
  notesCount.textContent = String(currentNotes.length);
  emptyState.classList.toggle("hidden", currentNotes.length > 0);

  currentNotes.forEach((note) => {
    const card = noteTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = note.title;
    card.querySelector("time").textContent = formatDate(note.updatedAt);
    card.querySelector(".note-body").textContent = note.content;

    const attachmentLink = card.querySelector(".attachment-link");
    if (note.attachment?.key) {
      attachmentLink.href = "#";
      attachmentLink.textContent = `Open ${note.attachment.name || "attachment"}`;
      attachmentLink.classList.add("visible");
      attachmentLink.addEventListener("click", (event) => {
        event.preventDefault();
        openAttachment(note.attachment.key);
      });
    }

    card.querySelector(".edit-button").addEventListener("click", () => fillEditor(note));
    card.querySelector(".delete-button").addEventListener("click", () => deleteNote(note.id));

    notesList.appendChild(card);
  });
}

function fillEditor(note) {
  noteIdInput.value = note.id;
  noteTitleInput.value = note.title || "";
  noteContentInput.value = note.content || "";
  attachmentInput.value = "";
  editorTitle.textContent = "Edit note";
  attachmentHint.textContent = note.attachment?.name
    ? `Current attachment: ${note.attachment.name}. Choose a new file only if you want to replace it.`
    : "Optional: PDF, image, document, spreadsheet, or text file.";
  noteTitleInput.focus();
}

async function deleteNote(noteId) {
  const user = auth.currentUser;
  if (!user) {
    return;
  }

  const confirmed = window.confirm("Delete this note from Firestore?");
  if (!confirmed) {
    return;
  }

  await deleteDoc(noteDocRef(user.uid, noteId));
  if (noteIdInput.value === noteId) {
    resetNoteForm();
  }
}

async function uploadAttachmentToS3(file, userId) {
  if (!S3_PRESIGN_API_URL || S3_PRESIGN_API_URL.includes("YOUR_AWS")) {
    throw new Error("Set S3_PRESIGN_API_URL in firebase-config.js before uploading attachments.");
  }

  const response = await fetch(S3_PRESIGN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      userId
    })
  });

  if (!response.ok) {
    throw new Error("Could not get AWS S3 upload permission.");
  }

  const { uploadUrl, key } = await response.json();

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });

  if (!uploadResponse.ok) {
    throw new Error("AWS S3 upload failed.");
  }

  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    key
  };
}

async function openAttachment(key) {
  try {
    const response = await fetch(S3_PRESIGN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "get",
        key,
        userId: auth.currentUser.uid
      })
    });

    if (!response.ok) {
      throw new Error("Could not create attachment download link.");
    }

    const { downloadUrl } = await response.json();
    window.open(downloadUrl, "_blank", "noopener");
  } catch (error) {
    setMessage(noteMessage, error.message || "Could not open attachment.", "error");
  }
}

function resetNoteForm() {
  noteForm.reset();
  noteIdInput.value = "";
  editorTitle.textContent = "Create note";
  attachmentHint.textContent = "Optional: PDF, image, document, spreadsheet, or text file.";
}

function notesCollectionRef(userId) {
  return collection(db, "users", userId, "notes");
}

function noteDocRef(userId, noteId) {
  return doc(db, "users", userId, "notes", noteId);
}

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function readableFirebaseError(error) {
  const code = error?.code || "";

  if (code.includes("auth/email-already-in-use")) {
    return "This email is already registered.";
  }

  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return "Invalid email or password.";
  }

  if (code.includes("auth/weak-password")) {
    return "Password should be at least 6 characters.";
  }

  if (code.includes("permission-denied")) {
    return "Firestore permission denied. Check your security rules.";
  }

  return error?.message || "Something went wrong.";
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) {
    return "Just now";
  }

  return timestamp.toDate().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}
