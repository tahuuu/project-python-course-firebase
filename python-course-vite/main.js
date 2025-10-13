console.log('main.js executed');
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, setLogLevel } from "firebase/firestore";

// Global Firebase variables
window.initializeApp = initializeApp;
window.getAuth = getAuth;
window.signInAnonymously = signInAnonymously;
window.signInWithCustomToken = signInWithCustomToken;
window.onAuthStateChanged = onAuthStateChanged;
window.getFirestore = getFirestore;
window.doc = doc;
window.setDoc = setDoc;
window.getDoc = getDoc;
window.onSnapshot = onSnapshot;
window.setLogLevel = setLogLevel;

// --- 0. GLOBAL CONFIGURATION & SETUP ---

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const appId = import.meta.env.VITE_FIREBASE_APP_ID;

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
const TTS_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=";

// Hardcoded content for the very first lesson to ensure instant load speed.
const INITIAL_LESSON_MARKDOWN = `
# Introduction to Variables and Data Types
## EXPLANATION:
Think of a **variable** in Python like a labeled box you use to store a value. The label is the variable name (like \`age\`) and the value is what's inside the box (like \`30\`).

The **data type** determines what kind of information that box can hold. The basic types we use here are:
* **Integers (\`int\`):** Whole numbers (e.g., \`10\`, \`42\`).
* **Floats (\`float\`):** Numbers with a decimal point (e.g., \`3.14\`, \`1.0\`).
* **Strings (\`str\`):** Text enclosed in quotes (e.g., \`"Hello"\`, \`'Python'\`).
* **Booleans (\`bool\`):** True or False.

Assigning a value is done using the equals sign (\`=\`). For example: \`score = 100\`. This creates the variable \`score\` and puts the integer value \`100\` inside it.

## TASK:
Your goal is to create three variables and then print them out to the console using the \`print()\` function.
1.  Create a variable named \`user_name\` and assign it a **string** value (your name).
2.  Create a variable named \`favorite_number\` and assign it an **integer** value.
3.  Create a variable named \`is_learning\` and assign it the boolean value **True**.
4.  Finally, print all three variables on separate lines.

\`\`\`python
# Start your code below!

\`\`\`
NEXT_ID: P01L02
DIFFICULTY: Beginner
`;

// Firebase Globals (Initialized later)
let app, db, auth, userId = null;
let isAuthReady = false;

// Course State
const PHASES = [
    "1: Basics (Variables, Data Types, Operators)",
    "2: Control Flow (Conditionals, Loops, Functions)",
    "3: Data Handling (Lists, Dictionaries, File I/O)",
    "4: Libraries & APIs (Requests, JSON, Custom API focus)",
    "5: Advanced Concepts (OOP, Error Handling, Generators)",
    "6: Specialization (Custom Project Track)"
];

let courseState = {
    currentPhaseIndex: 0,
    currentLessonId: 'P01L01',
    completedLessons: [],
    phaseLessons: {},
    expandedPhases: [],
    // 'lessonData' stores the structured content from the LLM/Hardcoded lesson
    lessonData: {
        title: 'Welcome',
        explanation: 'Initializing...',
        task: '', // Current task goal
        startCode: '', // Code to pre-populate editor
        difficulty: 'Beginner',
        nextLessonId: 'P01L01'
    }
};

// DOM Elements
const $ = selector => document.querySelector(selector);
const elements = {
    authStatus: $('#auth-status'),
    displayUserId: $('#display-user-id'),
    lessonTitle: $('#lesson-title'),
    lessonContent: $('#lesson-content'),
    codeEditor: $('#code-editor'),
    consoleOutput: $('#console-output'),
    runCodeBtn: $('#run-code-btn'),
    submitBtn: $('#submit-btn'),
    hintBtn: $('#hint-btn'),
    analogyBtn: $('#analogy-btn'),
    readAloudBtn: $('#read-aloud-btn'),
    lessonAudio: $('#lesson-audio'),
    aiMentorBox: $('#ai-mentor-box'),
    mentorMessage: $('#mentor-message'),
    coursePhases: $('#course-phases'),
    loadingSpinner: $('#loading-spinner'),
    initialLoadingMessage: $('#initial-loading-message'),
    promptModal: $('#prompt-modal'),
    modalInput: $('#modal-input'),
    modalSubmit: $('#modal-submit'),
    toggleSidebar: $('#toggle-sidebar'),
    sidebar: $('#sidebar'),
    phaseLoadingPlaceholder: $('#phase-loading-placeholder')
};

// --- 1. UTILITY FUNCTIONS ---

// Simple Markdown to HTML conversion (for basic LLM output)
function markdownToHtml(markdown) {
    let html = markdown
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" class="text-blue-600 hover:text-blue-800">$1</a>')
        .replace(/^\s*\n/gm, '<p>')
        .replace(/^- (.*$)/gim, '<li>$1</li>')
        .replace(/(\n<\/li>\n)/g, '</li>')
        .replace(/^(<li>.*<\/li>)$/gim, '<ul>$1</ul>')
        .replace(/`{3}python\n([\s\S]*?)`{3}/gim, (match, code) => `<pre><code>${code.trim()}</code></pre>`);
    
    // Handle lists correctly
    html = html.replace(/<\/ul>\s*<ul>/g, '').replace(/<\/ol>\s*<ol>/g, '');

    // Convert remaining newlines to paragraphs
    html = html.split('\n').map(line => line.trim() === '' || line.startsWith('<') ? line : `<p>${line}</p>`).join('');

    return html;
}

// Display message in the console and auto-scroll
function printToConsole(message, type = 'log') {
    const output = elements.consoleOutput;
    const timestamp = new Date().toLocaleTimeString();
    let color = 'text-green-400';

    if (type === 'error') {
        color = 'text-red-400';
    } else if (type === 'feedback') {
        color = 'text-yellow-300';
    }

    output.innerHTML += `<span class="text-gray-500">[${timestamp}]</span> <span class="${color}">${message}</span>\n`;
    output.scrollTop = output.scrollHeight;
}

// Show/Hide Loading Indicator
function toggleLoading(isLoading, message = "Processing with AI...") {
    const messageEl = elements.initialLoadingMessage;
    const lessonContent = elements.lessonContent;
    const loadingMessageText = document.getElementById('loading-message-text');
    
    if (isLoading) {
        // Show AI generation message
        lessonContent.classList.add('hidden');
        messageEl.classList.remove('hidden');
        loadingMessageText.textContent = message;
        
        // Disable controls while loading
        elements.runCodeBtn.disabled = true;
        elements.submitBtn.disabled = true;
        elements.hintBtn.disabled = true;
        elements.analogyBtn.disabled = true; 
        elements.readAloudBtn.disabled = true; 
        elements.codeEditor.disabled = true;

    } else {
        // Hide loading message
        messageEl.classList.add('hidden');
        lessonContent.classList.remove('hidden');
        
        // Enable controls only if content is loaded (and not Phase 6 waiting for modal input)
        if (courseState.lessonData.task && courseState.currentPhaseIndex !== 5) {
            elements.runCodeBtn.disabled = false;
            elements.submitBtn.disabled = false;
            elements.hintBtn.disabled = false;
            elements.analogyBtn.disabled = false; 
            elements.readAloudBtn.disabled = false; 
            elements.codeEditor.disabled = false;
        }
    }
}

// --- 2. FIREBASE / AUTHENTICATION ---

async function initializeFirebase() {
    setLogLevel('Debug');
    elements.phaseLoadingPlaceholder.classList.add('hidden');

    try {

        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        
        if (Object.keys(firebaseConfig).length === 0) {
            throw new Error("Firebase configuration not found. Running in demo mode.");
        }

        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        elements.authStatus.textContent = 'Authenticating...';

        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                elements.authStatus.textContent = 'Online';
                elements.authStatus.classList.replace('text-red-500', 'text-green-500');
                elements.displayUserId.textContent = userId;
                isAuthReady = true;
                listenForProgress();
            } else {
                userId = crypto.randomUUID();
                elements.authStatus.textContent = 'Anonymous';
                elements.displayUserId.textContent = userId;
                isAuthReady = true;
                loadProgressFromLocalState();
            }
        });
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        elements.authStatus.textContent = 'Demo Mode (No Persistence)';
        elements.authStatus.classList.replace('text-red-500', 'text-yellow-500');
        userId = crypto.randomUUID();
        elements.displayUserId.textContent = userId;
        isAuthReady = true;
        loadProgressFromLocalState();
    }
}

function getProgressDocRef() {
    if (!userId || !db) return null;

    // Firestore path for user's private data: /artifacts/{appId}/users/{userId}/python_course/progress
    return doc(db, 'artifacts', appId, 'users', userId, 'python_course', 'progress');
}

function loadProgressFromLocalState() {
    console.warn("Using in-memory state. Progress will not persist.");
    if (localStorage.getItem('pythonCourseState')) {
        const savedState = JSON.parse(localStorage.getItem('pythonCourseState'));
        Object.assign(courseState, savedState);
    }
    
    // Render content instantly regardless of saved state
    if (courseState.currentLessonId === 'P01L01') {
        const data = parseLessonContent(INITIAL_LESSON_MARKDOWN);
        courseState.lessonData = data;
        courseState.currentLessonId = 'P01L01';
        courseState.currentPhaseIndex = 0;
    }
    
    refreshCourseUI();
    renderLesson(courseState.lessonData);
}

// Listener for real-time progress updates from Firestore
function listenForProgress() {
    const docRef = getProgressDocRef();
    if (!docRef) {
        loadProgressFromLocalState();
        return;
    }

    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            Object.assign(courseState, data);
            console.log("Progress loaded/updated from Firestore:", data);
            refreshCourseUI();
            
            // Fetch the lesson corresponding to the loaded progress
            if (courseState.currentLessonId === 'P01L01' && !courseState.completedLessons.length) {
                 // Instant load for P01L01 if never completed
                 const data = parseLessonContent(INITIAL_LESSON_MARKDOWN);
                 courseState.lessonData = data;
                 renderLesson(data);
            } else {
                // Load or re-load the current lesson via AI (will show spinner)
                fetchLesson(courseState.currentLessonId);
            }

        } else {
            console.log("No existing progress found. Initializing new course.");
            // Instant load for the very first time
            const data = parseLessonContent(INITIAL_LESSON_MARKDOWN);
            courseState.lessonData = data;
            courseState.currentLessonId = 'P01L01';
            courseState.currentPhaseIndex = 0;
            renderLesson(data);
            
            // Initialize and save the new progress document
            saveProgress();
        }
    }, (error) => {
        console.error("Error listening to Firestore progress:", error);
        loadProgressFromLocalState();
    });
}

async function saveProgress() {
    if (!isAuthReady) return;
    try {
        const docRef = getProgressDocRef();
        if (docRef) {
            const stateToSave = {
                currentPhaseIndex: courseState.currentPhaseIndex,
                currentLessonId: courseState.currentLessonId,
                completedLessons: courseState.completedLessons
            };
            await setDoc(docRef, stateToSave, { merge: true });
            console.log("Progress saved successfully.");
        } else {
            localStorage.setItem('pythonCourseState', JSON.stringify(courseState));
        }
    } catch (error) {
        console.error("Failed to save progress:", error);
        localStorage.setItem('pythonCourseState', JSON.stringify(courseState));
    }
}

// --- 3. LLM API INTERACTION ---

const MAX_RETRIES = 5;
const INITIAL_DELAY = 1000;

/**
 * Calls the Gemini API with exponential backoff.
 */
async function callGemini(systemInstruction, userQuery) {
    const apiKey = API_KEY;
    const apiUrl = `${API_URL}${apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        // Use Google Search for project and data integration steps (Phases 3/4)
        tools: (courseState.currentPhaseIndex >= 2 && courseState.currentPhaseIndex <= 4) ? [{ "google_search": {} }] : [],
    };

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                if (i < MAX_RETRIES - 1) {
                    const delay = INITIAL_DELAY * Math.pow(2, i) + Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw new Error("Rate limit exceeded after multiple retries.");
            }

            if (!response.ok) {
                throw new Error(`API call failed with status: ${response.status}`);
            }

            const result = await response.json();
            const candidate = result.candidates?.[0];

            if (candidate && candidate.content?.parts?.[0]?.text) {
                const text = candidate.content.parts[0].text;
                let sources = [];
                const groundingMetadata = candidate.groundingMetadata;
                if (groundingMetadata && groundingMetadata.groundingAttributions) {
                    sources = groundingMetadata.groundingAttributions
                        .map(attribution => ({
                            uri: attribution.web?.uri,
                            title: attribution.web?.title,
                        }))
                        .filter(source => source.uri && source.title);
                }
                return { text, sources };
            }
            throw new Error("Received invalid response structure from API. The LLM failed to follow the strict markdown format.");

        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error.message);
            if (i === MAX_RETRIES - 1) {
                throw new Error("Failed to connect to the AI tutor after all retries.");
            }
            const delay = INITIAL_DELAY * Math.pow(2, i) + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// --- 4. COURSE LOGIC & RENDERING ---

// Mapping LLM markdown output to structured data
function parseLessonContent(markdown) {
    const data = {};
    const sections = {
        'title': /#\s*(.+)/i,
        'task': /##\s*TASK:([\s\S]*?)```python/i,
        'explanation': /##\s*EXPLANATION:([\s\S]*?)##\s*TASK:/i,
        'startCode': /```python\n([\s\S]*?)```/i,
        'nextLessonId': /NEXT_ID:\s*(\w+)/i,
        'difficulty': /DIFFICULTY:\s*(\w+)/i
    };

    // Extract core fields
    data.title = (markdown.match(sections.title) || [])[1]?.trim() || 'Untitled Lesson';
    data.task = (markdown.match(sections.task) || [])[1]?.trim() || 'No task provided.';
    data.startCode = (markdown.match(sections.startCode) || [])[1]?.trim() || '# Write your code below';
    data.nextLessonId = (markdown.match(sections.nextLessonId) || [])[1]?.trim() || 'P01L01';
    data.difficulty = (markdown.match(sections.difficulty) || [])[1]?.trim() || 'Medium';

    // Extract explanation content
    const explanationMatch = markdown.match(sections.explanation);
    data.explanation = explanationMatch ? explanationMatch[1].trim() : markdown.split('## TASK:')[0].trim();
    
    return data;
}

const lessonCache = {};

// Request new content from the LLM based on current state
async function fetchLesson(lessonId) {
    if (!isAuthReady) {
        setTimeout(() => fetchLesson(lessonId), 500);
        return;
    }

    // Check cache first
    if (lessonCache[lessonId]) {
        const data = lessonCache[lessonId];
        courseState.lessonData = data;
        const [currentPhase, currentLesson] = lessonId.split('L');
        const phaseIndex = parseInt(currentPhase.replace('P', '')) - 1;
        courseState.currentPhaseIndex = phaseIndex;
        courseState.currentLessonId = lessonId;
        renderLesson(data);
        return;
    }
    
    // CHECK FOR HARDCODED LESSON (P01L01)
    if (lessonId === 'P01L01' && !courseState.completedLessons.includes('P01L01')) {
        const data = parseLessonContent(INITIAL_LESSON_MARKDOWN);
        courseState.lessonData = data;
        courseState.currentLessonId = 'P01L01';
        courseState.currentPhaseIndex = 0;
        lessonCache[lessonId] = data; // Cache the initial lesson
        renderLesson(data);
        return;
    }
    // END CHECK

    toggleLoading(true, "Generating adaptive lesson...");
    elements.consoleOutput.textContent = '-- Console Ready --';
    
    const [currentPhase, currentLesson] = lessonId.split('L');
    const phaseIndex = parseInt(currentPhase.replace('P', '')) - 1;
    const phaseName = PHASES[phaseIndex];

    const systemInstruction = `You are a world-class, adaptive Python programming tutor in an interactive coding environment. Your goal is to guide the student through the course.
    1. **Format:** Output MUST be in Markdown.
    2. **STRICT STRUCTURE (MANDATORY):** The response MUST contain all these sections in this exact order:
        a. One Level 1 Heading: '# [Lesson Title]'
        b. One Level 2 Heading: '## EXPLANATION:' followed by the detailed explanation.
        c. One Level 2 Heading: '## TASK:' followed by the exercise description.
        d. One Python code block: \`\`\`python ... \`\`\`
        e. Two Metadata lines at the very end: 'NEXT_ID: [NewLessonId]' and 'DIFFICULTY: [Level]'.
    3. **Context:** The student is on Phase ${phaseIndex + 1}: ${phaseName}.
    4. **Difficulty:** Adjust the complexity based on the lesson ID. P01 should be simple. P06 should be complex/project-based.`;
    
    const userQuery = `The student is requesting lesson ${lessonId}. Generate the lesson content. 
    Phase: ${phaseName}. 
    Topic: Focus on the next logical topic for this phase.
    If this is Phase 6, set the task to be a project brief.
    The response must include:
    1. A title for the lesson (use # header).
    2. ## EXPLANATION: Detailed explanation of the concept with custom analogies and examples.
    3. ## TASK: A single, interactive exercise or project goal.
    4. The starting Python code (in a \`\`\`python block) for the student's editor.
    5. NEXT_ID: The ID of the next lesson (e.g., P01L0${parseInt(currentLesson) + 1} or P02L01 if phase change).
    6. DIFFICULTY: Beginner, Intermediate, or Advanced.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        const data = parseLessonContent(response.text);
        
        // Cache the new lesson
        lessonCache[lessonId] = data;

        // Update state and UI
        courseState.currentPhaseIndex = phaseIndex;
        courseState.currentLessonId = lessonId;
        courseState.lessonData = data;
        
        renderLesson(data);
        
        // If it's Phase 6, prompt for specialization interest
        if (phaseIndex === 5) {
            showModal('Project Specialization', 'You have mastered the fundamentals! To create your custom specialization track, please enter your interest (e.g., AI/ML, Web Development, Finance, Data Science).');
        }
        
        saveProgress();

    } catch (error) {
        elements.lessonContent.innerHTML = `<p class="text-red-600 font-bold">Error loading lesson: ${error.message}</p>`;
        elements.mentorMessage.textContent = "I apologize, the connection to the AI mentor failed. Please check your API configuration or try again shortly.";
    } finally {
        toggleLoading(false);
    }
}

// Render the course content to the UI
function renderLesson(data) {
    elements.lessonTitle.textContent = `${courseState.currentLessonId}: ${data.title}`;
    elements.lessonContent.innerHTML = markdownToHtml(data.explanation);
    elements.lessonContent.innerHTML += `<div class="task-goal-box mt-6 p-4 bg-gray-100 border-l-4 border-blue-500 rounded-lg">
        <h3 class="font-bold text-lg text-gray-800">🎯 Task Goal:</h3>
        <p class="text-gray-700 mt-2">${data.task}</p>
    </div>`;
    
    elements.codeEditor.value = data.startCode;
    elements.codeEditor.disabled = false;
    elements.runCodeBtn.disabled = false;
    elements.submitBtn.disabled = false;
    elements.hintBtn.disabled = false;
    elements.analogyBtn.disabled = false; // Enable new button
    elements.readAloudBtn.disabled = false; // Enable new button

    // Hide audio player when new lesson loads
    elements.lessonAudio.classList.add('hidden');
    
    elements.mentorMessage.textContent = `You are now on **${data.title}** (Difficulty: ${data.difficulty}). Read the explanation, complete the task, and run your code!`;
    refreshCourseUI();
}

function renderLockedLesson(lessonId) {
    const lesson = courseState.phaseLessons[lessonId.substring(0, 3)].find(l => l.lessonId === lessonId);
    elements.lessonTitle.textContent = `${lessonId}: ${lesson.title}`;
    elements.lessonContent.innerHTML = `<p class="text-red-500 font-semibold">Please finish the previous lesson first.</p>`;
    
    elements.codeEditor.value = '';
    elements.codeEditor.disabled = true;
    elements.runCodeBtn.disabled = true;
    elements.submitBtn.disabled = true;
    elements.hintBtn.disabled = true;
    elements.analogyBtn.disabled = true;
    elements.readAloudBtn.disabled = true;
}

async function fetchPhaseLessons(phaseId) {
    const phaseIndex = parseInt(phaseId.replace('P', '')) - 1;
    const phaseName = PHASES[phaseIndex];

    const systemInstruction = `You are a curriculum designer. Generate a list of lesson titles and IDs for a given phase of a Python course. The output should be a JSON array of objects, where each object has a 'lessonId' and 'title' property.`;
    
    const userQuery = `Generate a list of lesson titles and IDs for Phase ${phaseIndex + 1}: ${phaseName}.\n            The lesson IDs should follow the format PXXLYY, where XX is the phase number and YY is the lesson number.\n            For example, for Phase 1, the lesson IDs should be P01L01, P01L02, etc.\n            Provide at least 5 lessons for the phase.\n            The output should be a valid JSON array.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        const jsonMatch = response.text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            const lessons = JSON.parse(jsonMatch[1]);
            courseState.phaseLessons[phaseId] = lessons;
            refreshCourseUI();
        } else {
            // try parsing directly
            const lessons = JSON.parse(response.text);
            courseState.phaseLessons[phaseId] = lessons;
            refreshCourseUI();
        }
    } catch (error) {
        console.error('Error fetching phase lessons:', error);
        // Handle error, e.g., show a message to the user
    }
}

async function togglePhase(phaseId) {
    const phaseIndex = parseInt(phaseId.replace('P', '')) - 1;
    if (courseState.expandedPhases.includes(phaseId)) {
        // Collapse the phase
        courseState.expandedPhases = courseState.expandedPhases.filter(id => id !== phaseId);
        refreshCourseUI();
    } else {
        // Expand the phase
        courseState.expandedPhases.push(phaseId);
        if (!courseState.phaseLessons[phaseId]) {
            await fetchPhaseLessons(phaseId);
        } else {
            refreshCourseUI();
        }
    }
}

// Regenerate the sidebar navigation based on current state
function refreshCourseUI() {
    elements.coursePhases.innerHTML = '';
    PHASES.forEach((phaseName, index) => {
        const phaseEl = document.createElement('div');
        const phaseId = `P0${index + 1}`;
        const isActivePhase = index === courseState.currentPhaseIndex;
        const isExpanded = courseState.expandedPhases.includes(phaseId);
        
        const phaseClasses = isActivePhase 
            ? 'bg-blue-100 font-bold text-blue-800 border-l-4 border-blue-500' 
            : 'text-gray-700 hover:bg-gray-100 cursor-pointer';

        let lessonsHTML = '';
        if (isExpanded && courseState.phaseLessons[phaseId]) {
            lessonsHTML = '<div class="ml-4 mt-1 space-y-1">';
            courseState.phaseLessons[phaseId].forEach(lesson => {
                const isCompleted = courseState.completedLessons.includes(lesson.lessonId);
                const isCurrentLesson = lesson.lessonId === courseState.currentLessonId;
                const lessonNumber = parseInt(lesson.lessonId.substring(4));
                const previousLessonId = phaseId + 'L' + ('0' + (lessonNumber - 1)).slice(-2);
                const isFirstLesson = lessonNumber === 1;
                const isPreviousLessonCompleted = isFirstLesson || courseState.completedLessons.includes(previousLessonId);
                const isAccessible = isCompleted || isCurrentLesson || isPreviousLessonCompleted;

                let lessonClasses = 'text-gray-500';
                if (isAccessible) {
                    lessonClasses = 'text-gray-700 hover:text-gray-900 cursor-pointer';
                }
                if (isCurrentLesson) {
                    lessonClasses = 'font-bold text-blue-600';
                }

                lessonsHTML += `
                    <div class="p-1 rounded-md ${lessonClasses}" data-lesson-id="${lesson.lessonId}" data-accessible="${isAccessible}">
                        <div class="font-semibold text-xs">Lesson ${lesson.lessonId.substring(4)}</div>
                        <div class="text-xs text-gray-500">${lesson.title} ${isCompleted ? '✅' : ''}</div>
                    </div>
                `;
            });
            lessonsHTML += '</div>';
        }

        phaseEl.innerHTML = `
            <div class="p-2 rounded-lg transition duration-150 ${phaseClasses}" 
                 data-phase-id="${phaseId}">
                ${phaseName}
            </div>
            ${lessonsHTML}
        `;
        elements.coursePhases.appendChild(phaseEl);
    });
    
    // Re-attach click listeners for phases
    elements.coursePhases.querySelectorAll('div[data-phase-id]').forEach(el => {
        el.addEventListener('click', () => {
            const phaseId = el.dataset.phaseId;
            togglePhase(phaseId);
        });
    });

    // Re-attach click listeners for lessons
    elements.coursePhases.querySelectorAll('div[data-lesson-id]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const lessonId = el.dataset.lessonId;
            const isAccessible = el.dataset.accessible === 'true';
            if (isAccessible) {
                fetchLesson(lessonId);
            } else {
                renderLockedLesson(lessonId);
            }
        });
    });
}

// --- 5. INTERACTIVE FUNCTIONALITY (SIMULATED) ---

// Simulates running Python code by having the LLM predict the output/error
async function handleRunCode() {
    printToConsole("--- Running Code Simulation ---", 'log');
    toggleLoading(true, "Simulating execution and generating console output...");

    const studentCode = elements.codeEditor.value;
    const task = courseState.lessonData.task;

    const systemInstruction = "You are a Python code execution simulator and debugger. The student's code is run against a specific task. Based on the code, provide the expected console output or a Python traceback error. Output ONLY the console content, nothing else.";

    const userQuery = `Simulate the execution of the following Python code for the task: "${task}".
    
    ### Student Code
    \`\`\`python
    ${studentCode}
    \`\`\`
    
    Provide ONLY the expected console output or a clean, standard Python error message/traceback. Do not add any explanatory text or formatting outside of the simulated output. If the code is successful, output the result. If the code would cause an error, output the relevant traceback.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        const output = response.text.trim();
        
        elements.consoleOutput.textContent = ''; // Clear console
        
        if (output.toLowerCase().includes('error') || output.toLowerCase().includes('traceback')) {
            printToConsole("RUNTIME ERROR DETECTED (Simulated):", 'error');
            printToConsole(output, 'error');
        } else {
            printToConsole("Code ran successfully (Simulated Output):", 'log');
            printToConsole(output, 'log');
        }

        elements.mentorMessage.textContent = "Code execution complete. Review the console output to verify your logic.";
    } catch (error) {
        printToConsole(`AI Simulation Failed: ${error.message}`, 'error');
    } finally {
        toggleLoading(false);
    }
}

// Gets a hint from the LLM
async function handleGetHint() {
    printToConsole("--- Requesting Smart Hint ---", 'feedback');
    toggleLoading(true, "Generating context-aware hint...");

    const studentCode = elements.codeEditor.value;
    const task = courseState.lessonData.task;

    const systemInstruction = "You are a supportive and smart AI mentor. Your job is to provide a context-aware hint based on the student's code and the task, **without giving away the solution**. Use encouraging language.";

    const userQuery = `The current task is: "${task}". The student's current code is: 
    \`\`\`python
    ${studentCode}
    \`\`\`
    
    Provide a detailed, contextual hint. If the code is completely wrong, guide them back to the concept. If they are close, point out the specific line or method they should review. Limit the hint to 3-4 sentences.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        elements.mentorMessage.textContent = `**Smart Hint:** ${response.text.trim()}`;
    } catch (error) {
        printToConsole(`AI Hint Failed: ${error.message}`, 'error');
    } finally {
        toggleLoading(false);
    }
}

// **NEW FEATURE 1: Custom Analogy Generation**
async function handleGetAnalogy() {
    printToConsole("--- Requesting Custom Analogy ---", 'feedback');
    toggleLoading(true, "Generating a custom analogy...");
    
    const concept = courseState.lessonData.title;
    const explanation = elements.lessonContent.innerText.split('🎯 Task Goal:')[0];

    const systemInstruction = "You are a creative learning specialist. Your job is to create a compelling, easy-to-understand real-world analogy or visualization idea for a complex programming concept. Output ONLY the analogy explanation, without surrounding text or introductions. Use a friendly, tutor-like tone.";

    const userQuery = `The current Python concept is: "${concept}". The existing explanation text is: "${explanation.substring(0, 300)}...". Generate a creative, single-paragraph analogy (e.g., using cooking, sports, or nature) to explain this concept.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        elements.mentorMessage.innerHTML = `**✨ Concept Analogy:** ${response.text.trim()}`;
    } catch (error) {
        printToConsole(`AI Analogy Failed: ${error.message}`, 'error');
        elements.mentorMessage.textContent = "Sorry, I couldn't generate an analogy right now.";
    } finally {
        toggleLoading(false);
    }
}

// Submits the answer for grading and progression
async function handleSubmitAnswer() {
    printToConsole("--- Submitting for AI Review ---", 'feedback');
    toggleLoading(true, "AI mentor is performing detailed code review...");

    const studentCode = elements.codeEditor.value;
    const task = courseState.lessonData.task;
    const currentLessonId = courseState.currentLessonId;
    const nextLessonId = courseState.lessonData.nextLessonId;

    const systemInstruction = `You are a professional Python code reviewer and AI mentor. The student is submitting their solution.
    1. **Analyze:** Check if the submitted code logically fulfills the task.
    2. **Feedback:** Provide detailed feedback on code style, efficiency, and correctness (Code Quality Analysis).
    3. **Decision:** State clearly if the task is 'PASSED' or 'FAILED'.
    4. **Format:** Use encouraging and professional language.`;
    
    const userQuery = `The current lesson is ${currentLessonId}, with the task: "${task}". The student's solution is:
    
    \`\`\`python
    ${studentCode}
    \`\`\`
    
    Review the code. Is the logic correct? Is the style efficient and professional? Give constructive, detailed feedback. Start your response with a clear 'PASSED' or 'FAILED' statement.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        const feedbackText = response.text.trim();
        
        elements.consoleOutput.textContent = ''; // Clear console
        printToConsole(`AI CODE REVIEW for ${currentLessonId}:`, 'feedback');
        printToConsole(feedbackText, 'log');

        if (feedbackText.toUpperCase().includes('PASSED')) {
            elements.mentorMessage.innerHTML = `**Congratulations!** You passed this lesson. ${feedbackText.substring(feedbackText.indexOf('PASSED') + 6)}`;
            
            if (!courseState.completedLessons.includes(currentLessonId)) {
                courseState.completedLessons.push(currentLessonId);
            }
            
            // Advance to the next lesson automatically
            setTimeout(() => {
                fetchLesson(nextLessonId);
            }, 3000); // Wait 3 seconds before moving on
        } else {
            elements.mentorMessage.innerHTML = `**Not quite yet.** You failed this submission. ${feedbackText.substring(feedbackText.indexOf('FAILED') + 6)}`;
            // For adaptive learning: in a real app, this would trigger an LLM request for an extra practice problem.
        }

        saveProgress();

    } catch (error) {
        printToConsole(`AI Review Failed: ${error.message}`, 'error');
    } finally {
        toggleLoading(false);
    }
}

// --- 6. MODAL HANDLER (For Specialization Track) ---

function showModal(title, description) {
    $('#modal-title').textContent = title;
    $('#modal-description').textContent = description;
    elements.promptModal.classList.remove('hidden');
}

function hideModal() {
    elements.promptModal.classList.add('hidden');
}

async function handleModalSubmit() {
    const interest = elements.modalInput.value.trim();
    if (!interest) {
        elements.mentorMessage.textContent = "Please enter your area of interest to start your specialization track.";
        return;
    }
    hideModal();
    toggleLoading(true, `Generating custom project brief for your ${interest} specialization track...`);
    
    const systemInstruction = `You are an expert curriculum designer. The student has requested a Phase 6 specialization project.
    1. **Format:** Output MUST be in Markdown.
    2. **STRICT STRUCTURE (MANDATORY):** The response MUST contain all these sections in this exact order:
        a. One Level 1 Heading: '# [Lesson Title]'
        b. One Level 2 Heading: '## EXPLANATION:' followed by the detailed explanation.
        c. One Level 2 Heading: '## TASK:' followed by the exercise description.
        d. One Python code block: \`\`\`python ... \`\`\`
        e. Two Metadata lines at the very end: 'NEXT_ID: [NewLessonId]' and 'DIFFICULTY: [Level]'.
    3. **Topic:** ${interest}.
    4. **Goal:** Create a multi-step project that culminates in a portfolio-ready application.`;
    
    const userQuery = `The student's specialization interest is: **${interest}**. Generate the first lesson (P06L01) for this track.

# Custom Project: Building a ${interest} Tool
## EXPLANATION: Introduce the project scope, required libraries, and high-level architecture for this specialization track.
## TASK: The first actionable step to start the project (e.g., set up environment, define core functions).
\`\`\`python
# Starter code for the ${interest} project step 1
print("Project setup complete.")
\`\`\`
NEXT_ID: P06L02
DIFFICULTY: Advanced.`;

    try {
        const response = await callGemini(systemInstruction, userQuery);
        const data = parseLessonContent(response.text);
        courseState.lessonData = data;
        renderLesson(data);
        courseState.currentLessonId = 'P06L01';
        saveProgress();
        elements.mentorMessage.textContent = `Excellent choice! Your personalized **${interest}** specialization track is ready.`;
    } catch (error) {
        elements.lessonContent.innerHTML = `<p class="text-red-600 font-bold">Error generating custom project: ${error.message}</p>`;
    } finally {
        toggleLoading(false);
    }
}

// --- 7. TEXT-TO-SPEECH (TTS) FUNCTIONALITY ---

// Helper to convert base64 audio data (PCM) to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Helper to write string data to DataView for WAV header
function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Helper to convert PCM 16-bit audio data to a playable WAV Blob
function pcmToWav(pcm16, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    
    const wavBuffer = new ArrayBuffer(44 + pcm16.length * 2);
    const view = new DataView(wavBuffer);
    
    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // File size (4 bytes)
    view.setUint32(4, 36 + pcm16.length * 2, true);
    // WAVE identifier
    writeString(view, 8, 'WAVE');
    // fmt sub-chunk identifier
    writeString(view, 12, 'fmt ');
    // fmt sub-chunk size (16 for PCM)
    view.setUint32(16, 16, true);
    // Audio format (1 for PCM)
    view.setUint16(20, 1, true);
    // Number of channels (1)
    view.setUint16(22, numChannels, true);
    // Sample rate (4 bytes)
    view.setUint32(24, sampleRate, true);
    // Byte rate (4 bytes)
    view.setUint32(28, byteRate, true);
    // Block align (2 bytes)
    view.setUint16(32, blockAlign, true);
    // Bits per sample (2 bytes)
    view.setUint16(34, bitsPerSample, true);
    // data sub-chunk identifier
    writeString(view, 36, 'data');
    // data sub-chunk size (4 bytes)
    view.setUint32(40, pcm16.length * 2, true);
    
    // Write PCM data
    let offset = 44;
    for (let i = 0; i < pcm16.length; i++) {
        view.setInt16(offset, pcm16[i], true);
        offset += 2;
    }
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

// **NEW FEATURE 2: Read Aloud (TTS)**
async function handleReadAloud() {
    // Get only the main explanation text, excluding task goal and code
    const textToSpeak = elements.lessonContent.innerText.split('🎯 Task Goal:')[0].trim();
    
    if (textToSpeak.length < 10) {
        elements.mentorMessage.textContent = "Cannot read aloud: Lesson content is too short or hasn't loaded.";
        return;
    }

    elements.mentorMessage.textContent = "Generating audio... This may take a few seconds.";
    elements.readAloudBtn.disabled = true;
    elements.lessonAudio.classList.add('hidden');
    
    const ttsApiUrl = `${TTS_API_URL}${API_KEY}`;
    
    const payload = {
        contents: [{
            parts: [{ text: `Say in an informative and friendly tone: ${textToSpeak}` }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    // Using 'Kore' as a firm, informative voice
                    prebuiltVoiceConfig: { voiceName: "Kore" } 
                }
            }
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    try {
        const response = await fetch(ttsApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`TTS API call failed with status: ${response.status}`);
        }

        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType && mimeType.startsWith("audio/L16")) {
            const match = mimeType.match(/rate=(\d+)/);
            if (!match) throw new Error("Could not determine sample rate from MIME type.");
            const sampleRate = parseInt(match[1], 10);
            
            const pcmData = base64ToArrayBuffer(audioData);
            const pcm16 = new Int16Array(pcmData);
            const wavBlob = pcmToWav(pcm16, sampleRate);
            const audioUrl = URL.createObjectURL(wavBlob);
            
            elements.lessonAudio.src = audioUrl;
            elements.lessonAudio.classList.remove('hidden');
            elements.lessonAudio.play();
            elements.mentorMessage.textContent = "Audio ready. Use the player below to listen to the lesson explanation.";
            
        } else {
            throw new Error("Received invalid audio data or MIME type from TTS API.");
        }

    } catch (error) {
        console.error("TTS generation error:", error);
        elements.mentorMessage.textContent = `Error generating audio: ${error.message}. Try refreshing the lesson.`;
    } finally {
        elements.readAloudBtn.disabled = false;
    }
}


// --- 8. EVENT LISTENERS AND INITIALIZATION ---

window.onload = () => {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
    const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');

    // Set initial icon
    if (localStorage.getItem('theme') === 'dark') {
        themeToggleLightIcon.classList.remove('hidden');
    } else {
        themeToggleDarkIcon.classList.remove('hidden');
    }

    themeToggleBtn.addEventListener('click', function() {
        document.documentElement.classList.toggle('dark-mode');
        themeToggleDarkIcon.classList.toggle('hidden');
        themeToggleLightIcon.classList.toggle('hidden');

        let theme = 'light';
        if (document.documentElement.classList.contains('dark-mode')) {
            theme = 'dark';
        }
        localStorage.setItem('theme', theme);
    });
    initializeFirebase();
};


elements.runCodeBtn.addEventListener('click', handleRunCode);
        elements.submitBtn.addEventListener('click', handleSubmitAnswer);
        elements.hintBtn.addEventListener('click', handleGetHint);
        elements.analogyBtn.addEventListener('click', handleGetAnalogy);
        elements.readAloudBtn.addEventListener('click', handleReadAloud);
        elements.modalSubmit.addEventListener('click', handleModalSubmit);

        // Sidebar Toggling for Mobile
        elements.toggleSidebar.addEventListener('click', () => {
            elements.sidebar.classList.toggle('-translate-x-full');
            elements.sidebar.classList.toggle('translate-x-0');
        });

    

