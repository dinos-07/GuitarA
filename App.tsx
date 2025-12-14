
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Play, Music, Lock, Zap, Crown, Check, AlertCircle, BarChart3, Pause, Save, Loader2, BookOpen, GraduationCap, ListOrdered, Video } from 'lucide-react';
import { AppView, UserState, AnalysisResult, Exercise } from './types';
import { analyzeGuitarAudio, generateGuitarExercise, generateExerciseVideo } from './services/geminiService';
import { Button, Card, Badge, Modal } from './components/ui';

// Mock Initial Exercises with Full Course Content
const INITIAL_EXERCISES: Exercise[] = [
  {
    id: 'ex-1',
    title: 'Chromatic Warmup',
    difficulty: 'Beginner',
    description: 'A classic to loosen up fingers. Play slowly and rhythmically.',
    theory: 'This exercise, often called "The Spider", is fundamental for developing finger independence. It does not focus on melody, but purely on muscular technique and left/right hand synchronization.',
    lessonSteps: [
      'Place your index finger on the Low E string, 1st fret.',
      'Play the note, then place your middle finger on the 2nd fret without lifting the index.',
      'Continue with the ring finger (3rd fret) and pinky (4th fret).',
      'Switch strings and repeat the process up to the High E string.',
      'Keep your thumb centered behind the neck.'
    ],
    tablature: `e|-------------------------1-2-3-4-|
B|-----------------1-2-3-4---------|
G|---------1-2-3-4-----------------|
D|-1-2-3-4-------------------------|
A|---------------------------------|
E|-1-2-3-4-------------------------|`,
    isLocked: false
  },
  {
    id: 'ex-2',
    title: 'Minor Pentatonic (A)',
    difficulty: 'Beginner',
    description: 'The essential scale for rock and blues.',
    theory: 'The minor pentatonic scale consists of 5 notes per octave. It is the most widely used scale in Rock and Blues because all the notes sound good together over a standard chord progression.',
    lessonSteps: [
      'Position your index finger on the 5th fret (A) of the low string.',
      'Use your pinky for the 8th fret.',
      'For the following strings (A, D, G), use Index (5) and Ring (7).',
      'Try to play with strict alternate picking.',
      'Memorize the geometric shape under your fingers.'
    ],
    tablature: `e|---------------------5-8-|
B|-----------------5-8-----|
G|-------------5-7---------|
D|---------5-7-------------|
A|-----5-7-----------------|
E|-5-8---------------------|`,
    isLocked: true // Locked for free users if quota exceeded (logic handled in component)
  }
];

const MAX_FREE_RECORDINGS = 5;
const MAX_FREE_EXERCISES = 1;

function App() {
  // Navigation State
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);

  // User State
  const [user, setUser] = useState<UserState>({
    isPremium: false,
    recordingsUsed: 0,
    exercisesUsed: 0
  });

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  // Audio Visualization State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Exercise State
  const [exercises, setExercises] = useState<Exercise[]>(INITIAL_EXERCISES);
  const [generatingExercise, setGeneratingExercise] = useState(false);
  const [activeExercise, setActiveExercise] = useState<Exercise | null>(null);
  const [generatingVideoFor, setGeneratingVideoFor] = useState<string | null>(null);

  // Cleanup audio URL on unmount or change
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [audioUrl]);

  // --- Visualizer Logic ---
  const startVisualizer = (stream: MediaStream) => {
    if (!canvasRef.current) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    
    source.connect(analyser);
    analyser.fftSize = 256;
    
    audioContextRef.current = audioCtx;
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    
    if (!canvasCtx) return;

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = '#11111b'; // Match bg-dark-900
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for(let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        // Gradient color based on frequency/loudness
        const r = barHeight + (25 * (i/bufferLength));
        const g = 250 * (i/bufferLength);
        const b = 50;

        canvasCtx.fillStyle = `rgb(${r},${g},${b})`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();
  };

  const stopVisualizer = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    // We don't close AudioContext immediately to avoid re-init issues if user restarts quickly,
    // but typically we should close it or suspend it.
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.suspend();
    }
  };

  // --- Handlers ---

  const handleUpgrade = () => {
    // Simulate payment process
    if (confirm("Confirm payment of $7.99 for Premium subscription?")) {
      setUser(prev => ({ ...prev, isPremium: true }));
      // Unlock all local exercises visually
      setExercises(prev => prev.map(ex => ({ ...ex, isLocked: false })));
      alert("Congratulations! You are now Premium.");
      setCurrentView(AppView.DASHBOARD);
    }
  };

  const startRecording = async () => {
    if (!user.isPremium && user.recordingsUsed >= MAX_FREE_RECORDINGS) {
      alert("You have reached the limit of 5 free recordings. Upgrade to Premium!");
      setCurrentView(AppView.PREMIUM);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine the best supported mime type for the browser
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'; // Better for Safari/iOS
      }

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        
        stopVisualizer();
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setAnalysis(null);
      setAudioUrl(null);
      
      // Start Visualizer
      startVisualizer(stream);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Unable to access microphone. Please check that you have granted permission.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const submitForAnalysis = async () => {
    if (!audioBlob) return;

    setIsAnalyzing(true);
    try {
      // Convert Blob to Base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        // Remove data URL prefix (e.g., "data:audio/webm;base64,")
        const base64Content = base64data.split(',')[1];
        
        try {
          const result = await analyzeGuitarAudio(base64Content, audioBlob.type);
          setAnalysis(result);
          
          // Increment usage if not premium
          if (!user.isPremium) {
            setUser(prev => ({ ...prev, recordingsUsed: prev.recordingsUsed + 1 }));
          }
        } catch (error) {
          alert("Error during analysis: " + (error instanceof Error ? error.message : "Unknown error"));
        } finally {
          setIsAnalyzing(false);
        }
      };
    } catch (e) {
      setIsAnalyzing(false);
      alert("Audio processing error.");
    }
  };

  const handleCreateExercise = async () => {
    if (!user.isPremium && user.exercisesUsed >= MAX_FREE_EXERCISES) {
      alert("You have reached the free exercise limit. Upgrade to Premium!");
      setCurrentView(AppView.PREMIUM);
      return;
    }

    setGeneratingExercise(true);
    try {
      // Generate a random-ish topic based on array for demo variety
      const topics = ["Arpeggios", "Power Chords", "Funk Rhythms", "Blues Licks", "Fingerpicking", "Sweep Picking"];
      const randomTopic = topics[Math.floor(Math.random() * topics.length)];
      
      const newExData = await generateGuitarExercise("Intermediate", randomTopic);
      
      const newExercise: Exercise = {
        id: `gen-${Date.now()}`,
        ...newExData,
        isLocked: false
      };

      setExercises(prev => [newExercise, ...prev]);

      if (!user.isPremium) {
        setUser(prev => ({ ...prev, exercisesUsed: prev.exercisesUsed + 1 }));
      }
    } catch (e) {
      console.error(e);
      alert("Generation error: " + (e instanceof Error ? e.message : "Please try again."));
    } finally {
      setGeneratingExercise(false);
    }
  };

  const handleGenerateVideo = async (exercise: Exercise) => {
    try {
      // Check for API key presence using aistudio namespace first
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await aistudio.openSelectKey();
          // We assume success and proceed, but user might need to click again if race condition happens
        }
      }

      setGeneratingVideoFor(exercise.id);
      
      const videoUrl = await generateExerciseVideo(exercise.title, exercise.description);
      
      // Update exercises list and active exercise
      const updatedExercises = exercises.map(ex => 
        ex.id === exercise.id ? { ...ex, videoUrl } : ex
      );
      setExercises(updatedExercises);
      
      if (activeExercise && activeExercise.id === exercise.id) {
        setActiveExercise({ ...activeExercise, videoUrl });
      }

    } catch (error: any) {
      console.error("Video generation error:", error);
      
      let is404 = false;
      const errorString = typeof error === 'object' ? JSON.stringify(error) : String(error);
      
      // Check for various forms of 404 / Entity Not Found which indicates API key issues with Veo
      if (
        errorString.includes("Requested entity was not found") || 
        errorString.includes("404") || 
        error?.status === 404 || 
        error?.error?.code === 404
      ) {
        is404 = true;
      }

      setGeneratingVideoFor(null); // Stop loading spinner

      if (is404) {
        // Explicitly handle the "Requested entity was not found" error
        const confirmRetry = confirm("Video generation requires a paid Google Cloud Project API Key. It seems the current key is invalid or lacks permissions. Would you like to select a new key?");
        
        if (confirmRetry) {
          const aistudio = (window as any).aistudio;
          if (aistudio) {
             await aistudio.openSelectKey();
          }
        }
      } else {
        alert("Failed to generate video. Please try again.\n\n" + (error.message || errorString));
      }
    } finally {
      setGeneratingVideoFor(null);
    }
  };

  // --- Render Helpers ---

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="text-center space-y-2 py-8">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-brand-500 to-purple-500">
          guitarA
        </h1>
        <p className="text-gray-400">Your personal AI-powered guitar coach</p>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Your Progress" className="relative overflow-hidden">
           <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
              <BarChart3 size={100} />
           </div>
           <div className="space-y-4 relative z-10">
              <div className="flex justify-between items-center">
                 <span className="text-gray-400">Status</span>
                 {user.isPremium ? (
                   <Badge color="purple"><Crown size={12} className="inline mr-1"/> Premium</Badge>
                 ) : (
                   <Badge color="blue">Free</Badge>
                 )}
              </div>
              
              {!user.isPremium && (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Recordings</span>
                      <span>{user.recordingsUsed} / {MAX_FREE_RECORDINGS}</span>
                    </div>
                    <div className="h-2 bg-dark-900 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-brand-600 rounded-full transition-all duration-500" 
                        style={{ width: `${(user.recordingsUsed / MAX_FREE_RECORDINGS) * 100}%` }} 
                      />
                    </div>
                  </div>
                   <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Generated Lessons</span>
                      <span>{user.exercisesUsed} / {MAX_FREE_EXERCISES}</span>
                    </div>
                    <div className="h-2 bg-dark-900 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all duration-500" 
                        style={{ width: `${(user.exercisesUsed / MAX_FREE_EXERCISES) * 100}%` }} 
                      />
                    </div>
                  </div>
                </>
              )}

              {user.isPremium && (
                 <p className="text-green-400 text-sm flex items-center gap-2">
                   <Check size={16} /> Unlimited access active
                 </p>
              )}
           </div>
        </Card>

        <Card title="Quick Actions">
          <div className="space-y-3">
             <Button className="w-full justify-start" onClick={() => setCurrentView(AppView.STUDIO)}>
               <Mic size={20} /> New Audio Scan
             </Button>
             <Button className="w-full justify-start" variant="secondary" onClick={() => setCurrentView(AppView.EXERCISES)}>
               <Music size={20} /> My Lessons & Exercises
             </Button>
             {!user.isPremium && (
               <Button className="w-full justify-start" variant="outline" onClick={() => setCurrentView(AppView.PREMIUM)}>
                 <Zap size={20} /> Go Premium
               </Button>
             )}
          </div>
        </Card>
      </div>
    </div>
  );

  const renderStudio = () => (
    <div className="space-y-6 max-w-3xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Mic className="text-brand-500" /> Analysis Studio
        </h2>
        <span className="text-sm text-gray-400">
           {!user.isPremium ? `${MAX_FREE_RECORDINGS - user.recordingsUsed} attempts left` : 'Unlimited'}
        </span>
      </div>

      <Card className="text-center py-12 flex flex-col items-center justify-center min-h-[300px]">
         {!audioBlob && !isRecording && (
           <div className="space-y-6">
             <div className="w-24 h-24 rounded-full bg-dark-900 flex items-center justify-center mx-auto border-4 border-dashed border-gray-700 hover:border-brand-500 transition-colors cursor-pointer" onClick={startRecording}>
               <Mic size={40} className="text-gray-500 hover:text-brand-500 transition-colors" />
             </div>
             <p className="text-gray-400 max-w-sm mx-auto">
               Press record and play a riff, a scale, or a chord progression. AI will analyze your performance.
             </p>
             <Button onClick={startRecording} size="lg" className="mx-auto rounded-full w-16 h-16 p-0 flex items-center justify-center">
               <div className="w-4 h-4 bg-white rounded-sm"></div>
             </Button>
           </div>
         )}

         {isRecording && (
           <div className="space-y-8 w-full flex flex-col items-center">
              {/* Visualizer Canvas */}
              <div className="relative w-full max-w-md h-32 bg-dark-900 rounded-lg overflow-hidden border border-gray-700 shadow-inner">
                 <canvas 
                    ref={canvasRef} 
                    width={400} 
                    height={128} 
                    className="w-full h-full"
                 />
                 <div className="absolute top-2 right-2 flex gap-1 items-center">
                    <span className="animate-pulse w-2 h-2 bg-red-500 rounded-full"></span>
                    <span className="text-xs text-red-400 font-mono">REC</span>
                 </div>
              </div>
              
              <p className="text-brand-400 font-mono animate-pulse">Recording in progress...</p>
              <Button variant="secondary" onClick={stopRecording} className="mx-auto">
                <div className="w-3 h-3 bg-red-500 rounded-sm mr-2"></div> Stop
              </Button>
           </div>
         )}

         {audioBlob && !isRecording && !analysis && !isAnalyzing && (
            <div className="space-y-6 w-full max-w-md">
               <div className="bg-dark-900 p-4 rounded-lg flex flex-col gap-4">
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-600 rounded-full flex items-center justify-center">
                          <Music size={20} />
                        </div>
                        <div className="text-left">
                          <p className="font-medium text-white">Recording finished</p>
                          <p className="text-xs text-gray-500">Ready for analysis</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setAudioBlob(null); setAudioUrl(null); }}>X</Button>
                 </div>
                 
                 {/* Audio Player for verification */}
                 {audioUrl && (
                   <audio controls src={audioUrl} className="w-full h-8" />
                 )}
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                 <Button variant="secondary" onClick={() => { setAudioBlob(null); setAudioUrl(null); }}>Retry</Button>
                 <Button onClick={submitForAnalysis}>
                   <Zap size={18} /> Analyze
                 </Button>
               </div>
            </div>
         )}

         {isAnalyzing && (
           <div className="space-y-4">
             <Loader2 size={48} className="animate-spin text-brand-500 mx-auto" />
             <p className="text-gray-300">AI is analyzing your playing...</p>
             <p className="text-xs text-gray-500">Checking for rhythmic and tonal errors</p>
           </div>
         )}

         {analysis && (
           <div className="w-full text-left space-y-6 animate-in fade-in zoom-in-95 duration-300">
             <div className="flex items-center justify-between border-b border-gray-700 pb-4">
               <h3 className="text-xl font-bold">Result</h3>
               <div className={`px-4 py-2 rounded-full font-bold text-xl ${analysis.score >= 7 ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                 {analysis.score}/10
               </div>
             </div>

             <div className="space-y-4">
                <div className="bg-dark-900 p-4 rounded-lg border-l-4 border-blue-500">
                  <h4 className="text-blue-400 font-semibold mb-1 flex items-center gap-2"><Music size={16}/> Feedback</h4>
                  <p className="text-gray-300 text-sm leading-relaxed">{analysis.feedback}</p>
                </div>

                <div className="bg-dark-900 p-4 rounded-lg border-l-4 border-yellow-500">
                  <h4 className="text-yellow-400 font-semibold mb-1 flex items-center gap-2"><AlertCircle size={16}/> Technical Advice</h4>
                  <p className="text-gray-300 text-sm leading-relaxed">{analysis.technicalAdvice}</p>
                </div>

                <div className="bg-dark-900 p-4 rounded-lg border-l-4 border-purple-500">
                  <h4 className="text-purple-400 font-semibold mb-1 flex items-center gap-2"><Zap size={16}/> Theory Moment</h4>
                  <p className="text-gray-300 text-sm leading-relaxed">{analysis.theoryTip}</p>
                </div>
             </div>

             <Button className="w-full" onClick={() => { setAudioBlob(null); setAnalysis(null); setAudioUrl(null); }}>
               New Recording
             </Button>
           </div>
         )}
      </Card>
    </div>
  );

  const renderExercises = () => (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Lesson Library</h2>
          <p className="text-gray-400 text-sm">Generate complete, custom lessons with AI</p>
        </div>
        <Button onClick={handleCreateExercise} disabled={generatingExercise}>
           {generatingExercise ? <Loader2 className="animate-spin" /> : <><Zap size={18} /> Generate New Lesson</>}
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {exercises.map((ex, idx) => {
           // Logic to determine if locked:
           const isReallyLocked = !user.isPremium && ex.isLocked;

           return (
            <Card key={ex.id} className={`flex flex-col h-full ${isReallyLocked ? 'opacity-75 border-gray-800' : 'border-gray-700'}`}>
              <div className="flex justify-between items-start mb-2">
                 <Badge color={ex.difficulty === 'Beginner' ? 'green' : ex.difficulty === 'Intermediate' ? 'blue' : 'red'}>
                   {ex.difficulty}
                 </Badge>
                 {isReallyLocked && <Lock size={20} className="text-gray-500" />}
              </div>
              
              <h3 className="text-xl font-bold mb-2 text-white">{ex.title}</h3>
              <p className="text-gray-400 text-sm mb-4 flex-grow line-clamp-3">{ex.description}</p>

              <div className="bg-black/40 p-4 rounded-lg font-mono text-xs text-brand-200 overflow-x-auto whitespace-pre mb-4 border border-gray-800 shadow-inner max-h-24 overflow-hidden relative">
                 {isReallyLocked ? (
                   <div className="flex flex-col items-center justify-center py-4 text-gray-500 gap-2">
                     <Lock size={24} />
                     <p>Premium Content</p>
                   </div>
                 ) : (
                    <>
                       {ex.tablature}
                       <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-black/60 to-transparent"></div>
                    </>
                 )}
              </div>

              {isReallyLocked ? (
                <Button variant="outline" className="w-full mt-auto" onClick={() => setCurrentView(AppView.PREMIUM)}>
                  Unlock this lesson
                </Button>
              ) : (
                <Button 
                  variant="secondary" 
                  className="w-full mt-auto"
                  onClick={() => setActiveExercise(ex)}
                >
                   <Play size={16} /> Start Video Lesson
                </Button>
              )}
            </Card>
           );
        })}
      </div>
    </div>
  );

  const renderPremium = () => (
    <div className="max-w-4xl mx-auto text-center space-y-12 py-10 animate-in zoom-in-95 duration-500">
       <div className="space-y-4">
          <h2 className="text-4xl font-extrabold text-white">Level Up Your Playing</h2>
          <p className="text-xl text-gray-400">Unlock your full potential with AI.</p>
       </div>

       <div className="grid md:grid-cols-2 gap-8 items-center">
          {/* Free Tier */}
          <div className="p-8 rounded-2xl bg-dark-800 border border-gray-800 opacity-80 hover:opacity-100 transition-opacity">
             <h3 className="text-2xl font-bold text-gray-300 mb-2">Discovery</h3>
             <div className="text-4xl font-bold text-white mb-6">Free</div>
             <ul className="space-y-4 text-left text-gray-400 mb-8">
               <li className="flex gap-2"><Check className="text-green-500" /> 5 AI Audio Analyses</li>
               <li className="flex gap-2"><Check className="text-green-500" /> 1 Generated Lesson</li>
               <li className="flex gap-2"><Check className="text-green-500" /> Basic Feedback</li>
               <li className="flex gap-2 opacity-50"><Lock size={16} /> Unlimited History</li>
             </ul>
             <Button variant="outline" className="w-full" onClick={() => setCurrentView(AppView.DASHBOARD)}>
               Continue with Free
             </Button>
          </div>

          {/* Premium Tier */}
          <div className="relative p-8 rounded-2xl bg-gradient-to-b from-brand-900/40 to-dark-800 border-2 border-brand-500 shadow-2xl shadow-brand-900/20 transform md:scale-105">
             <div className="absolute top-0 right-0 bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg rounded-tr-lg">
               RECOMMENDED
             </div>
             <h3 className="text-2xl font-bold text-white mb-2">Pro Guitarist</h3>
             <div className="text-4xl font-bold text-white mb-2">$7.99 <span className="text-lg font-normal text-gray-400">/ month</span></div>
             <p className="text-sm text-gray-400 mb-6">Cancel anytime</p>
             
             <ul className="space-y-4 text-left text-gray-200 mb-8">
               <li className="flex gap-2"><Check className="text-brand-500" /> <strong>Unlimited Analyses</strong></li>
               <li className="flex gap-2"><Check className="text-brand-500" /> <strong>Unlimited Lessons</strong></li>
               <li className="flex gap-2"><Check className="text-brand-500" /> Detailed Technical Feedback</li>
               <li className="flex gap-2"><Check className="text-brand-500" /> Server Priority</li>
             </ul>
             <Button className="w-full py-4 text-lg" onClick={handleUpgrade}>
               <Zap className="mr-2" /> Go Premium
             </Button>
          </div>
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-dark-900 text-gray-200 font-sans selection:bg-brand-500 selection:text-white pb-20 md:pb-0">
      {/* Mobile Navbar (Bottom) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-800 border-t border-gray-800 z-50 px-6 py-3 flex justify-between items-center text-xs">
         <button onClick={() => setCurrentView(AppView.DASHBOARD)} className={`flex flex-col items-center gap-1 ${currentView === AppView.DASHBOARD ? 'text-brand-500' : 'text-gray-500'}`}>
           <BarChart3 size={24} /> <span>Home</span>
         </button>
         <button onClick={() => setCurrentView(AppView.STUDIO)} className={`flex flex-col items-center gap-1 ${currentView === AppView.STUDIO ? 'text-brand-500' : 'text-gray-500'}`}>
           <Mic size={24} /> <span>Studio</span>
         </button>
         <button onClick={() => setCurrentView(AppView.EXERCISES)} className={`flex flex-col items-center gap-1 ${currentView === AppView.EXERCISES ? 'text-brand-500' : 'text-gray-500'}`}>
           <Music size={24} /> <span>Lessons</span>
         </button>
         <button onClick={() => setCurrentView(AppView.PREMIUM)} className={`flex flex-col items-center gap-1 ${currentView === AppView.PREMIUM ? 'text-brand-500' : 'text-gray-500'}`}>
           <Crown size={24} /> <span>Premium</span>
         </button>
      </nav>

      {/* Desktop Navbar */}
      <nav className="hidden md:flex items-center justify-between px-8 py-4 bg-dark-800/50 backdrop-blur-md border-b border-gray-800 sticky top-0 z-50">
         <div className="flex items-center gap-2 text-brand-500 font-bold text-xl cursor-pointer" onClick={() => setCurrentView(AppView.DASHBOARD)}>
            <Music className="fill-current" /> guitarA
         </div>
         <div className="flex gap-6">
            <button onClick={() => setCurrentView(AppView.DASHBOARD)} className={`hover:text-white transition ${currentView === AppView.DASHBOARD ? 'text-white' : 'text-gray-400'}`}>Dashboard</button>
            <button onClick={() => setCurrentView(AppView.STUDIO)} className={`hover:text-white transition ${currentView === AppView.STUDIO ? 'text-white' : 'text-gray-400'}`}>Studio</button>
            <button onClick={() => setCurrentView(AppView.EXERCISES)} className={`hover:text-white transition ${currentView === AppView.EXERCISES ? 'text-white' : 'text-gray-400'}`}>My Lessons</button>
         </div>
         <Button variant={user.isPremium ? 'ghost' : 'primary'} size="sm" onClick={() => setCurrentView(AppView.PREMIUM)}>
            {user.isPremium ? <span className="text-yellow-500 flex items-center gap-1"><Crown size={16}/> Pro Member</span> : 'Subscribe'}
         </Button>
      </nav>

      {/* Main Content Area */}
      <main className="container mx-auto px-4 py-8 max-w-5xl">
         {currentView === AppView.DASHBOARD && renderDashboard()}
         {currentView === AppView.STUDIO && renderStudio()}
         {currentView === AppView.EXERCISES && renderExercises()}
         {currentView === AppView.PREMIUM && renderPremium()}
      </main>

      {/* Practice Modal (Full Lesson View) */}
      <Modal 
        isOpen={!!activeExercise} 
        onClose={() => setActiveExercise(null)} 
        title={activeExercise?.title || 'Lesson'}
      >
         <div className="space-y-6">
           {/* Video Section - NOW AT TOP AND CENTERED */}
           <div className="w-full bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-gray-800 relative min-h-[300px] flex items-center justify-center group">
             {activeExercise?.videoUrl ? (
               <video controls autoPlay src={activeExercise.videoUrl} className="w-full h-full object-contain bg-black" />
             ) : (
                // Placeholder / Call to Action
                <div className="text-center p-8 space-y-6 max-w-md">
                     <div className="w-20 h-20 bg-dark-800 rounded-full flex items-center justify-center mx-auto border border-gray-700 shadow-inner group-hover:scale-110 transition-transform">
                        <Video size={32} className="text-gray-600" />
                     </div>
                     <div className="space-y-2">
                        <h3 className="text-xl font-bold text-white">AI Demonstration</h3>
                        <p className="text-gray-400 text-sm">Visualize exactly how to play this exercise with an AI-generated explanatory video.</p>
                     </div>
                     <Button 
                       size="lg"
                       className="w-full shadow-brand-500/20"
                       onClick={() => activeExercise && handleGenerateVideo(activeExercise)}
                       disabled={generatingVideoFor === activeExercise?.id}
                     >
                       {generatingVideoFor === activeExercise?.id ? (
                         <><Loader2 className="animate-spin" /> Creating Explanatory Video...</>
                       ) : (
                         <><Zap size={18} /> Generate Explanatory Video</>
                       )}
                     </Button>
                     <p className="text-xs text-gray-600">Powered by Veo • Requires Google Cloud Billing</p>
                </div>
             )}
           </div>

           {/* Title & Metadata */}
           <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold text-white">{activeExercise?.title}</h2>
                <div className="flex gap-2">
                    <Badge color="blue">{activeExercise?.difficulty}</Badge>
                    {activeExercise?.isLocked && <Lock className="text-red-500" size={16} />}
                </div>
              </div>
              <p className="text-gray-300 text-lg">{activeExercise?.description}</p>
           </div>
           
           {/* Tablature (Moved Up) */}
           <div>
             <h4 className="text-white font-bold mb-3 flex items-center gap-2">
               <Music size={20} className="text-brand-500" /> Tablature
             </h4>
             <div className="bg-black/80 p-6 rounded-lg font-mono text-sm md:text-base text-brand-300 overflow-x-auto whitespace-pre border border-gray-700 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]">
               {activeExercise?.tablature}
             </div>
           </div>

           {/* Steps & Theory collapsed or below */}
           <div className="grid md:grid-cols-2 gap-6">
               <div>
                 <h4 className="text-white font-bold mb-4 flex items-center gap-2 border-b border-gray-700 pb-2">
                   <ListOrdered size={20} className="text-brand-500" /> Steps
                 </h4>
                 <div className="space-y-3">
                   {activeExercise?.lessonSteps?.map((step, i) => (
                     <div key={i} className="flex gap-4">
                       <div className="flex-shrink-0 w-8 h-8 rounded-full bg-dark-800 border border-gray-700 text-brand-500 flex items-center justify-center font-bold text-sm">
                         {i + 1}
                       </div>
                       <p className="text-gray-300 pt-1 text-sm">{step}</p>
                     </div>
                   ))}
                 </div>
               </div>

               <div className="bg-dark-900/50 border-l-4 border-purple-500 p-5 rounded-r-lg h-fit">
                 <h4 className="text-purple-400 font-bold mb-2 flex items-center gap-2">
                   <GraduationCap size={20} /> Theory
                 </h4>
                 <p className="text-gray-300 text-sm">{activeExercise?.theory}</p>
               </div>
           </div>

           {/* Footer Action */}
           <div className="sticky bottom-0 bg-dark-800 border-t border-gray-700 pt-4 mt-8 flex flex-col md:flex-row gap-4 items-center justify-between">
             <div className="text-sm text-gray-500 hidden md:block">
               <p>Mastered this? Try analyzing your playing.</p>
             </div>
             <Button size="lg" className="w-full md:w-auto shadow-xl shadow-brand-900/50" onClick={() => {
                setActiveExercise(null);
                setCurrentView(AppView.STUDIO);
             }}>
               <Mic size={20} /> Record this exercise
             </Button>
           </div>
         </div>
      </Modal>
    </div>
  );
}

export default App;
