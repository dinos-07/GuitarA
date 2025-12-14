
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, Exercise } from "../types";

// Initialize Gemini Client
// We assume process.env.API_KEY is available as per instructions
// Note: For Veo, we re-instantiate inside the function to ensure we get the latest key if updated via UI
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = "gemini-2.5-flash";

/**
 * Analyzes a guitar audio recording.
 * @param audioBase64 Base64 string of the audio file (without prefix)
 * @param mimeType Mime type of the audio (e.g., 'audio/webm')
 */
export const analyzeGuitarAudio = async (audioBase64: string, mimeType: string): Promise<AnalysisResult> => {
  try {
    const prompt = `
      Act as a world-class guitar teacher.
      Analyze this guitar audio recording.
      
      Provide a precise response with:
      - "score": a grade out of 10.
      - "feedback": detailed analysis (rhythm, pitch, clarity).
      - "technicalAdvice": precise technical advice to improve.
      - "theoryTip": music theory point related to what was played.
      
      Be encouraging but strict on precision. Respond in English.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioBase64
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            technicalAdvice: { type: Type.STRING },
            theoryTip: { type: Type.STRING },
          },
          required: ["score", "feedback", "technicalAdvice", "theoryTip"],
        }
      }
    });

    const textResponse = response.text;
    if (!textResponse) throw new Error("Empty AI response");

    return JSON.parse(textResponse) as AnalysisResult;

  } catch (error) {
    console.error("Error analyzing audio:", error);
    throw new Error("Unable to analyze audio. Please try again.");
  }
};

/**
 * Generates a guitar exercise with a full lesson plan.
 * @param level Difficulty level
 * @param topic Focus area (e.g., "Legato", "Chords")
 */
export const generateGuitarExercise = async (level: string, topic: string): Promise<Omit<Exercise, 'id' | 'isLocked'>> => {
  try {
    const prompt = `
      Generate a complete guitar lesson for a ${level} level on the topic: ${topic}.
      
      The response must contain:
      1. A catchy "title".
      2. A short "description".
      3. The "theory": Explain why we play this, the musical context (2-3 sentences).
      4. "lessonSteps": A list of 3 to 5 precise steps to play the exercise (finger position, picking motion, etc.).
      5. The "tablature" in ASCII text format (6 lines E A D G B e).
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            description: { type: Type.STRING },
            theory: { type: Type.STRING },
            lessonSteps: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            tablature: { type: Type.STRING },
          },
          required: ["title", "difficulty", "description", "theory", "lessonSteps", "tablature"],
        }
      }
    });

    const textResponse = response.text;
    if (!textResponse) throw new Error("Empty AI response");

    return JSON.parse(textResponse);

  } catch (error) {
    console.error("Error generating exercise:", error);
    throw new Error("Unable to generate lesson. Please check your connection or try again.");
  }
};

/**
 * Generates a video demonstration for a guitar exercise using Veo.
 * @param title Exercise title
 * @param description Exercise description
 */
export const generateExerciseVideo = async (title: string, description: string): Promise<string> => {
  try {
    // Re-initialize to ensure we use the potentially newly selected API key
    const client = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Improved prompt for EDUCATIONAL content rather than cinematic
    const prompt = `
      Educational guitar tutorial video. 
      Close-up shot of a guitarist's hands on the fretboard.
      The guitarist is demonstrating a technique called: "${title}".
      Context: ${description}.
      
      Style: Clear, bright, instructional video. 
      Action: The hands play slowly and deliberately to show correct finger placement.
      Focus: Sharp focus on the fingers and strings. Neutral background.
      Resolution: High definition.
    `;

    let operation = await client.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      }
    });

    // Poll for completion
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await client.operations.getVideosOperation({operation: operation});
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw new Error("Video generation failed to return a URI");

    // Fetch the actual video content using the API key
    const response = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
    if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);
    
    const blob = await response.blob();
    return URL.createObjectURL(blob);

  } catch (error) {
    console.error("Error generating video:", error);
    throw error;
  }
};
