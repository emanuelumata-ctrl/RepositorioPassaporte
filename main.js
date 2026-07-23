import { Html5QrcodeScanner } from "html5-qrcode";
import './style.css';

// Firebase Imports
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/storage';
import 'firebase/compat/firestore';
import 'firebase/compat/functions';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
};

// --- INITIALIZATION ---
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const storage = firebase.storage();
const db = firebase.firestore();
const functions = firebase.app().functions('us-central1');

// --- CONFIGURATION ---
const ADMIN_IDENTIFIERS = ["emanuelumata@gmail.com", "37017837"];
const DUMMY_DOMAIN = "example.com";

// --- DOM ELEMENTS ---
const appContainer = document.getElementById('app-container');
const loginContainer = document.getElementById('login-container');
const content = document.getElementById('content');

// --- APP STATE ---
let currentUser = null;
let trainingHistory = [];
let collectedStamps = [];
const totalStampSlots = 20;
let activeScanner = null;
let isScanning = false;
let adminCurrentPage = 1;
const adminItemsPerPage = 100;
let allAdminTrainings = [];
let allStampCounts = [];

// --- HELPER FUNCTIONS ---
function clearContainer(container) {
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
}

function createEl(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    for (const child of children) {
        if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child));
        } else if (child) {
            el.appendChild(child);
        }
    }
    return el;
}

// --- AUTHENTICATION LOGIC ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        appContainer.style.display = 'flex';
        loginContainer.style.display = 'none';
        setupTabs();
        document.getElementById('home-link').click();
    } else {
        currentUser = null;
        trainingHistory = [];
        collectedStamps = [];
        allAdminTrainings = [];
        adminCurrentPage = 1;
        renderLoginOrRegisterScreen();
    }
});

function renderLoginOrRegisterScreen(isRegistering = false) {
    appContainer.style.display = 'none';
    loginContainer.style.display = 'flex';
    clearContainer(loginContainer);

    const logo = createEl('img', {
        src: 'https://firebasestorage.googleapis.com/v0/b/aplicativo-fes-61767803-3989d.firebasestorage.app/o/ForviaExcellenceSystem4.0_Logo_RVB%20(1).png?alt=media&token=2fa4b594-6306-407c-9a47-2e4a6d2d7be3',
        alt: 'Forvia Logo',
        className: 'login-logo'
    });
    const title = 'Passaporte do Conhecimento';
    const subtitle = isRegistering ? 'Crie sua conta.' : 'Faça login para continuar.';

    const nameInput = isRegistering ? createEl('input', { type: 'text', id: 'name-input', placeholder: 'Nome Completo', required: true }) : null;
    const matriculaInput = createEl('input', { type: 'text', id: 'matricula-input', placeholder: 'Login', required: true });
    
    matriculaInput.oninput = function () {
        this.value = this.value.replace(/\D/g, '');
    };

    const dobInput = createEl('input', { type: isRegistering ? 'text' : 'password', id: 'dob-input', placeholder: 'Data de Nascimento (DDMMYYYY)', required: true });
    const authError = createEl('p', { id: 'auth-error', className: 'auth-error' });
    const actionButton = createEl('button', { id: isRegistering ? 'register-button' : 'login-button', textContent: isRegistering ? 'Registrar' : 'Entrar' });

    const consentCheckbox = isRegistering ? createEl('input', { type: 'checkbox', id: 'consent-checkbox' }) : null;
    const consentLabel = isRegistering ? createEl('label', { htmlFor: 'consent-checkbox' }, ['Eu concordo que meus dados de registro sejam usados apenas para registro e programação de treinamento. Estou ciente que o download desse app pode consumir meus dados móveis.']) : null;
    const consentContainer = isRegistering ? createEl('div', { className: 'consent-container' }, [consentCheckbox, consentLabel]) : null;

    if (isRegistering) {
        actionButton.disabled = true;
    }

    const toggleLink = createEl('a', { href: '#', textContent: isRegistering ? 'Faça login' : 'Registre-se' });
    const toggleP = createEl('p', { className: 'toggle-link' }, [isRegistering ? 'Já tem uma conta? ' : 'Não tem uma conta? ', toggleLink]);

    const formElements = [
        logo,
        createEl('h1', { textContent: title }),
        createEl('p', { textContent: subtitle }),
        nameInput,
        matriculaInput,
        dobInput,
        consentContainer,
        authError,
        actionButton,
        toggleP
    ].filter(Boolean);

    const form = createEl('div', { className: 'login-form' }, formElements);
    loginContainer.appendChild(form);

    toggleLink.addEventListener('click', (e) => {
        e.preventDefault();
        renderLoginOrRegisterScreen(!isRegistering);
    });

    if (isRegistering) {
        consentCheckbox.addEventListener('change', () => {
            actionButton.disabled = !consentCheckbox.checked;
        });
    }

    actionButton.addEventListener('click', () => {
        const matricula = matriculaInput.value.trim();
        const dob = dobInput.value.trim();
        
        if (isRegistering) {
            if (!consentCheckbox.checked) {
                authError.textContent = 'Você deve concordar com os termos para se registrar.';
                return;
            }
            const displayName = nameInput.value.trim();
            if (!matricula || !dob || !displayName) {
                authError.textContent = 'Por favor, preencha todos os campos.';
                return;
            }
            if (!/^\d{8}$/.test(dob)) {
                authError.textContent = 'Formato da data de nascimento inválido. Use DDMMYYYY.';
                return;
            }
            const email = `${matricula}@${DUMMY_DOMAIN}`;
            auth.createUserWithEmailAndPassword(email, dob)
                .then(async ({ user }) => {
                    await user.updateProfile({ displayName });
                    await db.collection('users').doc(user.uid).set({ matricula, consentGiven: true }, { merge: true });
                })
                .catch(err => {
                    console.error("Registration error:", err);
                    authError.textContent = err.code === 'auth/email-already-in-use' ? 'Este login já está em uso.' : 'Ocorreu um erro no registro.';
                });
        } else {
            if (!matricula || !dob) {
                authError.textContent = 'Por favor, insira o login e a data de nascimento.';
                return;
            }
            const email = `${matricula}@${DUMMY_DOMAIN}`;
            auth.signInWithEmailAndPassword(email, dob).catch(err => {
                console.error("Login error:", err);
                authError.textContent = "Login ou data de nascimento inválida.";
            });
        }
    });
}


// --- FIRESTORE DATABASE LOGIC ---
async function loadUserData() {
    if (!currentUser) return;
    const userDocRef = db.collection('users').doc(currentUser.uid);
    const userDoc = await userDocRef.get();
    
    if (userDoc.exists && userDoc.data().matricula) {
        currentUser.matricula = userDoc.data().matricula;
    } else {
        const emailUsername = currentUser.email.split('@')[0];
        if (!ADMIN_IDENTIFIERS.includes(emailUsername)) {
            currentUser.matricula = emailUsername;
            await updateUserMatricula(emailUsername);
        } else {
            currentUser.matricula = ADMIN_IDENTIFIERS.find(id => id.includes(emailUsername));
        }
    }

    const trainingSnap = await userDocRef.collection('trainings').orderBy('date', 'desc').get();
    trainingHistory = trainingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const stampSnap = await userDocRef.collection('stamps').get();
    collectedStamps = stampSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateUserMatricula(matricula) {
    if (!currentUser) return;
    await db.collection('users').doc(currentUser.uid).set({ matricula }, { merge: true });
    currentUser.matricula = matricula;
}

async function saveTraining(trainingData) {
    return await db.collection('users').doc(currentUser.uid).collection('trainings').add(trainingData);
}

async function deleteTraining(trainingId) {
    await db.collection('users').doc(currentUser.uid).collection('trainings').doc(trainingId).delete();
}

async function saveStamp(stampUrl) {
    return await db.collection('users').doc(currentUser.uid).collection('stamps').add({ url: stampUrl });
}

async function deleteStamp(stampId) {
    await db.collection('users').doc(currentUser.uid).collection('stamps').doc(stampId).delete();
}

// --- SECURE GEMINI API LOGIC (via Cloud Function) ---
async function getTrainingCategory(trainingName) {
    try {
        const getCategoryFunction = functions.httpsCallable('getTrainingCategory');
        const result = await getCategoryFunction({ trainingName });
        return result.data;
    } catch (error) {
        console.error("Error calling getTrainingCategory cloud function:", error);
        return { category: "Outros" };
    }
}

// --- FIREBASE STORAGE LOGIC ---
async function uploadProfilePicture(file, userId) {
    const filePath = `profile-pictures/${userId}/${file.name}`;
    const fileRef = storage.ref().child(filePath);
    const snapshot = await fileRef.put(file);
    return await snapshot.ref.getDownloadURL();
}

// --- UI RENDERING FUNCTIONS ---
function renderHome() {
    clearContainer(content);

    const uploadStatus = createEl('p', { id: 'upload-status', className: 'upload-status' });
    const profileImg = createEl('img', {
        src: currentUser.photoURL || 'https://via.placeholder.com/100',
        alt: 'Foto do Usuário',
        id: 'profile-pic-preview',
        className: 'profile-pic-home'
    });
    const uploadInput = createEl('input', { type: 'file', id: 'profile-pic-upload', accept: 'image/*', style: { display: 'none' } });

    const profileSection = createEl('div', { className: 'profile-summary' }, [
        createEl('div', { className: 'profile-pic-container' }, [
            profileImg,
            createEl('label', { htmlFor: 'profile-pic-upload', className: 'profile-pic-upload-label' }, [
                createEl('span', {textContent: '+'})
            ]),
            uploadInput
        ]),
        createEl('h2', { id: 'user-name', textContent: currentUser.displayName || '' }),
        createEl('p', { textContent: `Login: ${currentUser.matricula || 'N/A'}` }),
        uploadStatus
    ]);
    
    const summarySection = createEl('div', { className: 'summary-container' }, [
        createEl('div', { className: 'summary-card' }, [ createEl('h2', {}, ['Treinamentos Concluídos']), createEl('p', {className: 'summary-value'}, [String(trainingHistory.length)]) ]),
        createEl('div', { className: 'summary-card' }, [ createEl('h2', {}, ['Selos Coletados']), createEl('p', {className: 'summary-value'}, [`${collectedStamps.length} / ${totalStampSlots}`]) ])
    ]);
    
    const logoutButton = createEl('button', { id: 'logout-button', className: 'btn-logout', textContent: 'Sair' });

    content.append(
        profileSection,
        createEl('h1', {}, ['Início']),
        createEl('p', {}, ['Bem-vindo! Aqui está o seu resumo:'],),
        summarySection,
        logoutButton
    );

    logoutButton.addEventListener('click', () => auth.signOut());
    uploadInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        profileImg.src = URL.createObjectURL(file);
        uploadStatus.textContent = 'Enviando foto...';
        try {
            const downloadURL = await uploadProfilePicture(file, currentUser.uid);
            await currentUser.updateProfile({ photoURL: downloadURL });
            uploadStatus.textContent = '✅ Foto atualizada!';
        } catch (error) {
            console.error("Upload failed", error);
            uploadStatus.textContent = '❌ Falha no upload.';
        } finally {
            setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
        }
    });
}

function showPlusOneAnimation() {
    const animationEl = createEl('div', { className: 'plus-one-animation', textContent: '+1' });
    document.body.appendChild(animationEl);

    // Trigger the animation
    setTimeout(() => {
        animationEl.classList.add('animate');
    }, 10);

    // Remove the element after the animation finishes
    animationEl.addEventListener('animationend', () => {
        animationEl.remove();
    });
}

function showPlusOneStampAnimation() {
    const animationEl = createEl('div', { className: 'plus-one-stamp-animation', textContent: '+1' });
    document.body.appendChild(animationEl);

    // Trigger the animation
    setTimeout(() => {
        animationEl.classList.add('animate');
    }, 10);

    // Remove the element after the animation finishes
    animationEl.addEventListener('animationend', () => {
        animationEl.remove();
    });
}

function renderTrainingRegistration() {
    clearContainer(content);

    if (!currentUser.matricula) {
        content.appendChild(createEl('div', {}, [
            createEl('h1', { textContent: 'Registro de Treinamento' }),
            createEl('p', { className: 'auth-error' }, ['Atenção: Por favor, vá para a aba "Início" e salve seu login antes de registrar um treinamento.'])
        ]));
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const signatureUrlInput = createEl('input', { type: 'hidden', id: 'signature-url' });
    const trainingNameInput = createEl('input', { type: 'text', id: 'training-name', required: true });
    const matriculaInput = createEl('input', { type: 'text', id: 'matricula', value: currentUser.matricula || '', readOnly: true, required: true });
    const trainerInput = createEl('input', { type: 'text', id: 'trainer', required: true });
    const hoursInput = createEl('input', { type: 'number', id: 'hours', required: true });
    const dateInput = createEl('input', { type: 'date', id: 'date', value: today, readOnly: true, required: true });
    const submitButton = createEl('button', { type: 'submit', textContent: 'Registrar' });
    const signatureDisplay = createEl('div', { id: 'signature-display' });
    const aiResponseDiv = createEl('div', { id: 'ai-response' });
    
    const fieldset = createEl('fieldset', { id: 'training-fieldset', disabled: true }, [
        createEl('legend', { textContent: 'Detalhes do Treinamento' }),
        signatureDisplay,
        signatureUrlInput,
        createEl('label', { htmlFor: 'training-name', textContent: 'Nome do treinamento:' }),
        trainingNameInput,
        createEl('label', { htmlFor: 'matricula', textContent: 'Login:' }),
        matriculaInput,
        createEl('label', { htmlFor: 'trainer', textContent: 'Treinador:' }),
        trainerInput,
        createEl('label', { htmlFor: 'hours', textContent: 'Horas:' }),
        hoursInput,
        createEl('label', { htmlFor: 'date', textContent: 'Data:' }),
        dateInput,
        submitButton
    ]);

    const form = createEl('form', { id: 'training-form' }, [fieldset]);
    
    const qrReaderStatus = createEl('div', { id: 'qr-reader-status' });
    const qrSection = createEl('div', { id: 'qr-validation-section' }, [
        createEl('p', { textContent: 'Aponte para o QR code para validar a assinatura.' }),
        createEl('div', { id: 'qr-reader' }),
        qrReaderStatus
    ]);
    
    content.append(
        createEl('h1', { textContent: 'Registro de Treinamento' }),
        qrSection,
        form,
        aiResponseDiv
    );
    
    const validStorageUrlPrefix = `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/`;
    activeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 }, videoConstraints: { facingMode: "environment" } }, false);
    
    activeScanner.render(async (decodedText) => {
        // Stop scanning immediately after a successful read
        if (activeScanner) {
            try {
                await activeScanner.clear();
                activeScanner = null;
            } catch (err) {
                console.error("Failed to clear scanner", err);
            }
        }

        try {
            // Attempt to parse the QR code text as JSON
            const qrData = JSON.parse(decodedText);

            // Check if the parsed object has the necessary properties
            if (qrData.signatureUrl && qrData.trainingName && qrData.hours !== undefined) {
                // Also validate that the signatureUrl is from our storage
                if (!qrData.signatureUrl.startsWith(validStorageUrlPrefix)) {
                    qrReaderStatus.textContent = '❌ URL da imagem no QR Code é inválida.';
                    return; 
                }

                // If everything is valid, populate the form fields
                qrReaderStatus.textContent = '✅ QR Code lido com sucesso!';
                signatureUrlInput.value = qrData.signatureUrl;
                trainingNameInput.value = qrData.trainingName;
                hoursInput.value = qrData.hours;
                signatureDisplay.innerHTML = `<p>Assinatura:</p><img src="${qrData.signatureUrl}" class="signature-image">`;
                
                // Enable the form for submission
                fieldset.disabled = false;

            } else {
                // JSON is valid, but missing required fields
                qrReaderStatus.textContent = '❌ QR Code não contém as informações necessárias (assinatura, nome, horas).';
            }
        } catch (e) {
            // This catch block handles cases where decodedText is not a valid JSON string.
            console.error("QR Code Parse Error:", e);
            qrReaderStatus.textContent = '❌ Formato do QR Code inválido.';
        }
    }, (err) => { 
        // This callback is for errors, we can ignore it for this implementation
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submitButton.disabled = true;
        submitButton.textContent = 'Registrando...';
        aiResponseDiv.textContent = 'Analisando e registrando...';

        try {
            const trainingName = trainingNameInput.value;
            const { category } = await getTrainingCategory(trainingName);
            const trainingData = {
                name: trainingName,
                matricula: matriculaInput.value,
                trainer: trainerInput.value,
                hours: hoursInput.value,
                date: dateInput.value,
                signatureUrl: signatureUrlInput.value,
                category: category,
                userEmail: currentUser.email
            };
            const newTraining = await saveTraining(trainingData);
            trainingHistory.unshift({ id: newTraining.id, ...trainingData });
            aiResponseDiv.textContent = '✅ Treinamento registrado com sucesso!';

            showPlusOneAnimation();

            form.reset();
            signatureDisplay.innerHTML = '';
            qrReaderStatus.innerHTML = '';
            fieldset.disabled = true;
            submitButton.textContent = 'Registrar'; // Reset text for next time

        } catch (error) {
            console.error("Erro ao registrar treinamento:", error);
            aiResponseDiv.textContent = `❌ Erro ao registrar. Tente novamente.`;
            submitButton.disabled = false; // Re-enable on error
            submitButton.textContent = 'Registrar'; // Reset text on error
        }
    });
}

function renderHistory() {
    clearContainer(content);
    
    const h1 = createEl('h1', { textContent: 'Histórico de Treinamentos' });
    content.appendChild(h1);

    if (trainingHistory.length === 0) {
        content.appendChild(createEl('p', { textContent: 'Nenhum treinamento registrado.' }));
        return;
    }

    const historyList = createEl('ul', { id: 'history-list' });
    trainingHistory.forEach(t => {
        const deleteBtn = createEl('button', { className: 'delete-btn delete-training-btn', textContent: 'Excluir' });
        deleteBtn.dataset.id = t.id;

        const signatureDiv = t.signatureUrl ? createEl('div', { className: 'signature-history-display' }, [
            createEl('p', { textContent: 'Assinatura:' }),
            createEl('img', { src: t.signatureUrl, alt: 'Assinatura', className: 'signature-image' })
        ]) : null;

        const listItem = createEl('li', { 'data-id': t.id }, [
            createEl('strong', { textContent: t.name }),
            createEl('span', { textContent: ` (Categoria: ${t.category})` }),
            createEl('p', { textContent: `Login: ${t.matricula || 'N/A'} | Treinador: ${t.trainer} | Horas: ${t.hours} | Data: ${t.date}` }),
            signatureDiv,
            deleteBtn
        ]);
        historyList.appendChild(listItem);
    });

    content.appendChild(historyList);

    historyList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-training-btn')) {
            const trainingId = e.target.dataset.id;
            if (confirm('Tem certeza que deseja excluir este registro de treinamento?')) {
                try {
                    await deleteTraining(trainingId);
                    e.target.closest('li').remove();
                    trainingHistory = trainingHistory.filter(t => t.id !== trainingId);
                } catch (error) {
                    console.error("Erro ao excluir treinamento:", error);
                    alert("Falha ao excluir o treinamento.");
                }
            }
        }
    });
}

function renderStamps() {
    clearContainer(content);
    isScanning = false;

    const stampSlots = Array.from({ length: totalStampSlots }, (_, i) => {
        const stamp = collectedStamps[i];
        if (stamp) {
            const deleteBtn = createEl('button', { className: 'delete-btn delete-stamp-btn', textContent: '×' });
            deleteBtn.dataset.id = stamp.id;
            return createEl('div', { className: 'stamp-slot' }, [
                createEl('img', { src: stamp.url, className: 'stamp-image' }),
                deleteBtn
            ]);
        }
        return createEl('div', { className: 'stamp-slot' });
    });

    const stampsContainer = createEl('div', { className: 'stamps-container', id: 'stamps-container' }, stampSlots);
    const statusEl = createEl('div', { id: 'qr-reader-status-stamps' });

    content.append(
        createEl('h1', { textContent: 'Página de Selos' }),
        createEl('p', { textContent: 'Escaneie o QR Code de um selo para adicioná-lo.' }),
        stampsContainer,
        createEl('div', { id: 'qr-validation-section-stamps' }, [
            createEl('div', { id: 'qr-reader-stamps' }),
            statusEl
        ])
    );
    
    stampsContainer.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-stamp-btn')) {
            const stampId = e.target.dataset.id;
            if (confirm('Tem certeza que deseja excluir este selo?')) {
                try {
                    await deleteStamp(stampId);
                    collectedStamps = collectedStamps.filter(s => s.id !== stampId);
                    renderStamps();
                } catch (error) {
                    console.error("Erro ao excluir selo:", error);
                    alert("Falha ao excluir o selo.");
                }
            }
        }
    });

    const validStorageUrlPrefix = `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/`;
    const specialStampUrl = "https://firebasestorage.googleapis.com/v0/b/aplicativo-fes-61767803-3989d.firebasestorage.app/o/5%20(2).png?alt=media&token=35e3afff-7fe5-42ad-98d3-a0e6d463d894";
    
    activeScanner = new Html5QrcodeScanner("qr-reader-stamps", { fps: 5, qrbox: { width: 250, height: 250 }, videoConstraints: { facingMode: "environment" } }, false);
    
    activeScanner.render(async (decodedText) => {
        // A scan is happening, so stop the scanner immediately to prevent multiple triggers.
        if (isScanning) {
            return;
        }
        isScanning = true;
        if (activeScanner) {
            try {
                await activeScanner.clear();
            } catch (error) {
                console.error("Error clearing scanner", error);
            }
            activeScanner = null;
        }

        // Validate QR code
        if (!decodedText.startsWith(validStorageUrlPrefix)) {
            statusEl.textContent = '❌ QR Code de selo inválido.';
            setTimeout(renderStamps, 2000); // Restart scanner after message
            return;
        }

        // Handle the special, non-repeatable stamp
        if (decodedText === specialStampUrl) {
            if (collectedStamps.some(s => s.url === decodedText)) {
                statusEl.textContent = '😉 Você já coletou este selo especial.';
                setTimeout(renderStamps, 2000); // Restart scanner after message
                return;
            }
        }

        // Add the new stamp if there's space
        if (collectedStamps.length < totalStampSlots) {
            statusEl.textContent = 'Salvando selo...';
            try {
                const newStamp = await saveStamp(decodedText);
                collectedStamps.push({ id: newStamp.id, url: decodedText });
                statusEl.textContent = '✅ Selo adicionado com sucesso!';
                showPlusOneStampAnimation();
                setTimeout(renderStamps, 1000); // Re-render with new stamp
            } catch (error) {
                console.error("Error saving stamp:", error);
                statusEl.textContent = '❌ Falha ao salvar o selo.';
                setTimeout(renderStamps, 2000); // Restart on error
            }
        } else {
            statusEl.textContent = '🚫 Todos os espaços de selo estão preenchidos.';
            setTimeout(renderStamps, 2000);
        }
    }, (error) => { /* Ignore */ });
}

async function renderAdminPanel() {
    clearContainer(content);
    content.appendChild(createEl('h1', { textContent: 'Painel do Administrador' }));
    content.appendChild(createEl('p', { id: 'loading-status', textContent: 'Carregando dados...' }));

    try {
        if (allAdminTrainings.length === 0) {
            if (auth.currentUser) await auth.currentUser.getIdToken(true);
            const getAdminReport = functions.httpsCallable('getAdminReport');
            const result = await getAdminReport();
            allAdminTrainings = result.data.allTrainings || [];
            allStampCounts = result.data.stampCounts || [];
        }

        const loadingStatus = document.getElementById('loading-status');
        if(loadingStatus) loadingStatus.remove();

        if (allAdminTrainings.length === 0) {
            content.appendChild(createEl('p', { textContent: 'Nenhum treinamento registrado por funcionários ainda.' }));
            return;
        }

        const totalPages = Math.ceil(allAdminTrainings.length / adminItemsPerPage);
        const paginatedTrainings = allAdminTrainings.slice((adminCurrentPage - 1) * adminItemsPerPage, adminCurrentPage * adminItemsPerPage);

        const trainingsTable = createEl('table', { className: 'admin-table' }, [
            createEl('thead', {}, [
                createEl('tr', {}, ['Funcionário', 'Login', 'Treinamento', 'Treinador', 'Horas', 'Data'].map(h => createEl('th', {textContent: h})))
            ]),
            createEl('tbody', {}, paginatedTrainings.map(t => createEl('tr', {}, [
                createEl('td', { textContent: t.userEmail || 'N/A' }),
                createEl('td', { textContent: t.matricula || 'N/A' }),
                createEl('td', { textContent: t.name }),
                createEl('td', { textContent: t.trainer }),
                createEl('td', { textContent: t.hours }),
                createEl('td', { textContent: t.date })
            ])))
        ]);
        
        const stampsTable = createEl('table', { className: 'admin-table' }, [
             createEl('thead', {}, [
                createEl('tr', {}, ['Funcionário', 'Quantidade de Selos'].map(h => createEl('th', {textContent: h})))
            ]),
            createEl('tbody', {}, allStampCounts.map(s => createEl('tr', {}, [
                createEl('td', { textContent: s.userEmail }),
                createEl('td', { textContent: s.stampCount })
            ])))
        ]);

        const prevPageBtn = createEl('button', { id: 'prev-page-btn', textContent: 'Anterior', disabled: adminCurrentPage === 1 });
        const nextPageBtn = createEl('button', { id: 'next-page-btn', textContent: 'Próximo', disabled: adminCurrentPage === totalPages });
        
        content.append(
            createEl('div', { className: 'admin-header' }, [
                createEl('p', { textContent: `Total de registros: ${allAdminTrainings.length}` }),
                createEl('button', { id: 'export-csv-button', className: 'btn-export', textContent: 'Exportar para Excel (CSV)' })
            ]),
            createEl('div', { className: 'admin-table-container'}, [trainingsTable]),
            createEl('div', { className: 'pagination-container' }, [
                prevPageBtn,
                createEl('span', { textContent: `Página ${adminCurrentPage} de ${totalPages}` }),
                nextPageBtn
            ]),
            createEl('br'),
            createEl('h2', {textContent: 'Ranking de Selos'}),
            createEl('div', { className: 'admin-table-container'}, [stampsTable])
        );

        document.getElementById('export-csv-button').addEventListener('click', () => downloadCSV(convertToCSV(allAdminTrainings), 'treinamentos.csv'));
        prevPageBtn.addEventListener('click', () => { if (adminCurrentPage > 1) { adminCurrentPage--; renderAdminPanel(); } });
        nextPageBtn.addEventListener('click', () => { if (adminCurrentPage < totalPages) { adminCurrentPage++; renderAdminPanel(); } });

    } catch (error) {
        console.error("Error fetching admin data: ", error);
        content.appendChild(createEl('p', { className: 'auth-error' }, [`Erro ao carregar dados: ${error.message}`]));
    }
}


// --- CSV EXPORT ---
function convertToCSV(data) {
    const headers = ["Funcionário", "Login", "Treinamento", "Treinador", "Horas", "Data"];
    const rows = data.map(t => [
        `"${t.userEmail || 'N/A'}"`, `"${t.matricula || 'N/A'}"`, `"${t.name || 'N/A'}"`,
        `"${t.trainer || 'N/A'}"`, `"${t.hours || 'N/A'}"`, `"${t.date || 'N/A'}"`
    ].join(','));
    return [headers.join(','), ...rows].join('\r\n');
}

function downloadCSV(csv, filename) {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = createEl('a', { href: URL.createObjectURL(blob), download: filename, style: { visibility: 'hidden' } });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// --- APP STARTUP ---
function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const adminLink = document.getElementById('admin-link');

    const isAdmin = currentUser && (ADMIN_IDENTIFIERS.includes(currentUser.email) || ADMIN_IDENTIFIERS.includes(currentUser.matricula));
    adminLink.style.display = isAdmin ? 'block' : 'none';

    const tabActions = {
        'home-link': renderHome,
        'register-link': renderTrainingRegistration,
        'history-link': renderHistory,
        'stamps-link': renderStamps,
        'admin-link': renderAdminPanel,
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', async (e) => {
            e.preventDefault();
            if (activeScanner) {
                try { await activeScanner.clear(); } catch (err) { /* ignore */ }
                activeScanner = null;
            }
            tabs.forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const tabId = e.currentTarget.id;
            if (tabActions[tabId]) {
                tabActions[tabId]();
            }
        });
    });
}
