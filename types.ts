
export enum AppView {
  DASHBOARD = 'DASHBOARD',
  STUDIO = 'STUDIO',
  EXERCISES = 'EXERCISES',
  PREMIUM = 'PREMIUM'
}

export interface UserState {
  isPremium: boolean;
  recordingsUsed: number;
  exercisesUsed: number; // 0 or 1 for free tier
}

export interface AnalysisResult {
  score: number;
  feedback: string;
  technicalAdvice: string;
  theoryTip: string;
}

export interface Exercise {
  id: string;
  title: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  description: string;
  tablature: string;
  theory: string; // Explication théorique du cours
  lessonSteps: string[]; // Étapes pas à pas pour réussir
  isLocked: boolean;
  videoUrl?: string; // Optional URL for the generated video
}
