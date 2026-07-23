const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Define as opções globais para todas as funções neste arquivo
setGlobalOptions({ region: "us-central1", secrets: ["GEMINI_KEY"] });

admin.initializeApp();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

exports.getTrainingCategory = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const trainingName = request.data.trainingName;
    if (!trainingName) {
        throw new HttpsError('invalid-argument', 'The function must be called with one argument "trainingName".');
    }
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const prompt = `Classifique o seguinte treinamento em uma das 5 categorias: "Segurança", "Operacional", "Comunicação", "Liderança", "Produto" ou "Outros". Forneça apenas o nome da categoria. Treinamento: "${trainingName}"`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let category = response.text().trim();
        const validCategories = ["Segurança", "Operacional", "Comunicação", "Liderança", "Produto", "Outros"];
        if (!validCategories.includes(category)) {
            category = "Outros";
        }
        return { category: category };
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new HttpsError('internal', 'Error calling Gemini API', error);
    }
});

exports.getAdminReport = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'A autenticação é inválida. A função precisa ser chamada por um usuário autenticado.');
    }
    
    const ADMIN_IDENTIFIERS = ["emanuelumata@gmail.com", "37017837"];
    const uid = request.auth.uid;
    let userEmail;
    let userMatricula;

    try {
        const userRecord = await admin.auth().getUser(uid);
        userEmail = userRecord.email;
        userMatricula = userEmail.split('@')[0];
    } catch (error) {
        console.error("Error fetching user data:", error);
        throw new HttpsError('internal', 'Erro ao buscar os dados do usuário.');
    }

    if (!ADMIN_IDENTIFIERS.includes(userEmail) && !ADMIN_IDENTIFIERS.includes(userMatricula)) {
        throw new HttpsError('permission-denied', 'Apenas administradores podem executar esta ação.');
    }

    const db = admin.firestore();
    const auth = admin.auth();
    const allTrainings = [];
    const userDataCache = {}; // Cache to avoid fetching the same user multiple times

    try {
        // --- 1. Fetch all trainings ---
        const trainingsSnapshot = await db.collectionGroup('trainings').orderBy('date', 'desc').get();
        for (const doc of trainingsSnapshot.docs) {
            const training = doc.data();
            const userId = doc.ref.parent.parent.id;

            // Fetch user email if not already in cache
            if (!userDataCache[userId]) {
                try {
                    const userRecord = await auth.getUser(userId);
                    userDataCache[userId] = { email: userRecord.email };
                } catch (userError) {
                    console.error("Error fetching user:", userId, userError);
                    userDataCache[userId] = { email: 'Usuário não encontrado' };
                }
            }

            allTrainings.push({
                ...training,
                userEmail: userDataCache[userId].email,
            });
        }

        // --- 2. Fetch all stamps and count them correctly ---
        const userStampCounts = {};
        const stampsSnapshot = await db.collectionGroup('stamps').get();

        for (const doc of stampsSnapshot.docs) {
            const userId = doc.ref.parent.parent.id;

            // Fetch user email if not already in cache.
            if (!userDataCache[userId]) {
                 try {
                    const userRecord = await auth.getUser(userId);
                    userDataCache[userId] = { email: userRecord.email };
                } catch (userError) {
                    console.error("Error fetching user:", userId, userError);
                    userDataCache[userId] = { email: 'Usuário não encontrado' };
                }
            }
            const currentUserEmail = userDataCache[userId].email;

            if (currentUserEmail === 'Usuário não encontrado'){
                continue;
            }

            // Increment stamp count for the user
            if (userStampCounts[currentUserEmail]) {
                userStampCounts[currentUserEmail]++;
            } else {
                userStampCounts[currentUserEmail] = 1;
            }
        }

        // --- 3. Format and sort the stamp counts report ---
        const stampCountsReport = Object.entries(userStampCounts).map(([email, count]) => ({
            userEmail: email,
            stampCount: count
        }));

        stampCountsReport.sort((a, b) => b.stampCount - a.stampCount);

        // --- 4. Return both reports ---
        return {
            allTrainings,
            stampCounts: stampCountsReport
        };

    } catch (error) {
        console.error("Erro ao gerar relatório administrativo:", error);
        throw new HttpsError('internal', 'Não foi possível gerar o relatório.', error.message);
    }
});