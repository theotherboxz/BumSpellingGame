'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Script from 'next/script';
import { motion, AnimatePresence } from 'motion/react';
import { Volume2, VolumeX, FastForward, SkipForward, HelpCircle, Check, X, RefreshCw } from 'lucide-react';

const FALLBACK_WORDS: Record<string, string[]> = {
  Easy: [
    'CAT', 'DOG', 'SUN', 'MAP', 'CUP', 'HAT', 'PEN', 'BOX', 'TOP', 'BED',
    'RUN', 'JAM', 'NET', 'LEG', 'BUS', 'BAT', 'FAN', 'PIG', 'TUB', 'WEB',
    'PIE', 'KEY', 'LIP', 'JAR', 'MOP', 'COW', 'ANT', 'BEE', 'BUG', 'RUG',
    'NUT', 'FOX', 'OWL', 'RAT', 'LOG', 'DOT', 'SAD', 'MAD', 'HOT', 'COLD',
    'BIG', 'RED', 'BLUE', 'GREEN', 'FAST'
  ],
  Normal: [
    'YELLOW', 'WINDOW', 'BOTTLE', 'GARDEN', 'PURPLE', 'BASKET', 'CIRCLE', 'DOCTOR', 'FATHER', 'MOTHER',
    'SCHOOL', 'ANSWER', 'BEHIND', 'CANDLE', 'DANGER', 'ESCAPE', 'FLOWER', 'TICKET', 'ANIMAL', 'BRIDGE',
    'BUTTON', 'CAMERA', 'CASTLE', 'FOREST', 'GUITAR', 'ISLAND', 'JACKET', 'LIZARD', 'MIRROR', 'ORANGE',
    'PENCIL', 'PIRATE', 'PLANET', 'RABBIT', 'ROCKET', 'SPIDER', 'AUTUMN', 'WINTER', 'SPRING', 'SUMMER',
    'SILVER', 'SHADOW', 'SUNSET', 'TEAPOT', 'TUNNEL'
  ],
  Hard: [
    'ACKNOWLEDGE', 'CHARACTERISTIC', 'HIERARCHY', 'KALEIDOSCOPE', 'ONOMATOPOEIA', 'QUESTIONNAIRE', 'SYNCHRONIZATION', 'TEMPERATURE', 'UBIQUITOUS', 'CHOREOGRAPHY',
    'EUCALYPTUS', 'IDIOSYNCRATIC', 'MARSHMALLOW', 'PTERODACTYL', 'RENDEZVOUS', 'MAYONNAISE', 'LIEUTENANT', 'SILHOUETTE', 'RHINOCEROS', 'XYLOPHONE',
    'YACHT', 'ZUCCHINI', 'ACCOMMODATE', 'ACCORDION', 'ANONYMOUS', 'CAMOUFLAGE', 'CAPPUCCINO', 'CATASTROPHE', 'CHRYSANTHEMUM', 'CONNOISSEUR',
    'DAIQUIRI', 'ECSTATIC', 'EMBARRASS', 'FLUORESCENT', 'HIPPOPOTAMUS', 'MISCELLANEOUS', 'NAUSEOUS', 'OUTRAGEOUS', 'PHARAOH', 'PSYCHOLOGY',
    'SQUIRREL', 'VACILLATE', 'VENGEANCE', 'ZEPPELIN'
  ]
};

declare global {
  interface Window {
    puter?: any;
  }
}

export default function SpellIt() {
  const [difficulty, setDifficulty] = useState<'Easy' | 'Normal' | 'Hard'>('Easy');
  const [words, setWords] = useState<string[]>([]);
  const [usedWords, setUsedWords] = useState<Set<string>>(new Set());
  const [currentWord, setCurrentWord] = useState<string>('');
  const [input, setInput] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'submitted'>('loading');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  
  const [score, setScore] = useState({ correct: 0, wrong: 0, total: 0 });
  const [streak, setStreak] = useState<boolean[]>([]);
  const [definition, setDefinition] = useState<{ pos: string, meaning: string } | null>(null);
  const [isDefinitionLoading, setIsDefinitionLoading] = useState(false);
  const [toast, setToast] = useState<{ title: string, message: string } | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const inputRef        = useRef<HTMLInputElement>(null);
  const loadTimeoutRef  = useRef<NodeJS.Timeout | null>(null);
  const kokoroRef        = useRef<any>(null);
  const kokoroLoadingRef  = useRef<boolean>(false);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const showToast = useCallback((title: string, message: string) => {
    setToast({ title, message });
    setTimeout(() => {
      setToast(prev => prev?.title === title ? null : prev);
    }, 5000);
  }, []);

  // Last-resort: browser built-in speech synthesis
  const browserSpeak = useCallback((wordToSpeak: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(wordToSpeak);
    utterance.rate = 0.82;
    utterance.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const usVoice = voices.find(v => v.lang === 'en-US');
    if (usVoice) utterance.voice = usVoice;
    utterance.onend  = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  // Fallback 2: Kokoro-82M (in-browser ONNX model)
  const initKokoro = useCallback(async () => {
    if (kokoroRef.current || kokoroLoadingRef.current) return;
    kokoroLoadingRef.current = true;
    try {
      const { KokoroTTS } = await import('kokoro-js');
      kokoroRef.current = await KokoroTTS.from_pretrained(
        'onnx-community/Kokoro-82M-v1.0',
        { dtype: 'q8' }
      );
    } catch (err) {
      console.warn('Kokoro failed to load:', err);
    }
    kokoroLoadingRef.current = false;
  }, []);

  const kokoroSpeak = useCallback(async (wordToSpeak: string): Promise<boolean> => {
    try {
      if (!kokoroRef.current) await initKokoro();
      if (!kokoroRef.current) return false;
      const audio = await kokoroRef.current.generate(wordToSpeak, { voice: 'af_heart' });
      await audio.play();
      setIsSpeaking(false);
      return true;
    } catch {
      return false;
    }
  }, [initKokoro]);

  // Play a raw audio Blob/ArrayBuffer via Web Audio API
  const playAudioBlob = useCallback(async (blob: Blob): Promise<void> => {
    const arrayBuffer = await blob.arrayBuffer();
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(ctx.destination);
    return new Promise((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
  }, []);

  // Primary: Chatterbox by Resemble AI (currently #1 trending TTS on Hugging Face)
  // Fallback 1: Meta MMS TTS (facebook/mms-tts-eng) – one of the most downloaded TTS on HF
  const hfSpeak = useCallback(async (wordToSpeak: string): Promise<boolean> => {
    try {
      const { HfInference } = await import('@huggingface/inference');
      const hf = new HfInference(); // uses free-tier serverless inference

      // Try Chatterbox first (most popular & natural sounding)
      try {
        const blob = await hf.textToSpeech({
          model: 'resemble-ai/chatterbox',
          inputs: wordToSpeak,
        });
        await playAudioBlob(blob);
        setVoiceStatus('ready');
        setIsSpeaking(false);
        return true;
      } catch (chatterboxErr) {
        console.warn('Chatterbox unavailable, trying MMS:', chatterboxErr);
      }

      // Try Meta MMS (facebook/mms-tts-eng) as secondary HF option
      const blob = await hf.textToSpeech({
        model: 'facebook/mms-tts-eng',
        inputs: wordToSpeak,
      });
      await playAudioBlob(blob);
      setVoiceStatus('ready');
      setIsSpeaking(false);
      return true;
    } catch (err) {
      console.warn('HF Inference TTS failed:', err);
      return false;
    }
  }, [playAudioBlob]);

  // Kick off HF voice check on mount
  const initHfVoice = useCallback(async () => {
    setVoiceStatus('loading');
    // Warm up Kokoro in parallel so it's ready as fallback
    initKokoro();
    // Probe HF with a silent test to set status
    try {
      const { HfInference } = await import('@huggingface/inference');
      const hf = new HfInference();
      await hf.textToSpeech({ model: 'facebook/mms-tts-eng', inputs: 'test' });
      setVoiceStatus('ready');
    } catch {
      setVoiceStatus('failed');
    }
  }, [initKokoro]);

  const speak = useCallback(async (wordToSpeak: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);

    // 1. Try Hugging Face (Chatterbox → MMS)
    const hfOk = await hfSpeak(wordToSpeak);
    if (hfOk) return;

    // 2. Try in-browser Kokoro-82M
    const kokoroOk = await kokoroSpeak(wordToSpeak);
    if (kokoroOk) return;

    // 3. Final fallback: browser speech synthesis
    setVoiceStatus('failed');
    browserSpeak(wordToSpeak);
  }, [isSpeaking, hfSpeak, kokoroSpeak, browserSpeak]);

  const fetchWords = useCallback(async (diff: 'Easy' | 'Normal' | 'Hard', excludeSet: Set<string>): Promise<string[]> => {
    try {
      if (!window.puter) throw new Error("Puter not loaded");
      
      const usedArray = Array.from(excludeSet);
      let prompt = `Generate exactly 25 unique spelling bee words for ${diff} difficulty. Output ONLY a raw JSON array of uppercase strings.`;
      if (usedArray.length > 0) {
        prompt += ` Do NOT include any of these words: ${usedArray.slice(-100).join(', ')}`;
      }
      
      const response = await window.puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
      let text = response.message.content.trim();
      text = text.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
      
      let newWords: string[] = [];
      try {
        newWords = JSON.parse(text);
      } catch (e) {
        throw new Error("Puter AI returned invalid JSON.");
      }
      
      if (!Array.isArray(newWords) || newWords.length === 0) {
        throw new Error("Puter AI returned an empty or invalid array.");
      }
      
      return newWords.map(w => String(w).toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length > 0);
    } catch (error: any) {
      console.error("AI Words Fetch Error:", error);
      showToast("Word Generation Failed", `Using built-in fallback list. (${error.message || 'Error'})`);
      
      // Fallback
      let available = FALLBACK_WORDS[diff].filter(w => !excludeSet.has(w));
      if (available.length === 0) {
        available = [...FALLBACK_WORDS[diff]];
      }
      return available.sort(() => Math.random() - 0.5).slice(0, 25);
    }
  }, [showToast]);

  const loadNewWordPool = useCallback(async (diff: 'Easy' | 'Normal' | 'Hard', currentUsed: Set<string>, resetScore = false) => {
    setStatus('loading');
    setDefinition(null);
    setInput('');
    setIsCorrect(null);
    setCurrentWord('');
    
    if (resetScore) {
      setScore({ correct: 0, wrong: 0, total: 0 });
      setStreak([]);
    }

    const fetchedWords = await fetchWords(diff, currentUsed);
    setWords(fetchedWords);
    
    if (fetchedWords.length > 0) {
      const firstWord = fetchedWords[0];
      setCurrentWord(firstWord);
      setUsedWords(prev => new Set(prev).add(firstWord));
      setWords(fetchedWords.slice(1));
      setStatus('idle');
      
      loadTimeoutRef.current = setTimeout(() => {
        speak(firstWord);
      }, 400);
    } else {
      showToast("Error", "Could not load any words.");
      setStatus('idle');
    }
  }, [fetchWords, showToast, speak]);

  useEffect(() => {
    // Defer voice model loading to avoid synchronous setState in effect body
    const voiceTimer = setTimeout(() => initHfVoice(), 0);

    const checkPuter = setInterval(() => {
      if (window.puter) {
        clearInterval(checkPuter);
        loadNewWordPool(difficulty, new Set(), true);
      }
    }, 500);
    
    // Auto-timeout if puter fails to load
    const puterTimeout = setTimeout(() => {
      clearInterval(checkPuter);
      if (!window.puter) {
        showToast("AI Offline", "Puter not loaded. Using offline dictionaries.");
        loadNewWordPool(difficulty, new Set(), true);
      }
    }, 5000);

    return () => {
      clearTimeout(voiceTimer);
      clearInterval(checkPuter);
      clearTimeout(puterTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    }
  }, []);

  const changeDifficulty = (newDiff: 'Easy' | 'Normal' | 'Hard') => {
    if (newDiff !== difficulty) {
      setDifficulty(newDiff);
      loadNewWordPool(newDiff, usedWords, false);
    }
  };

  const triggerNextWord = useCallback(async () => {
    setDefinition(null);
    setInput('');
    setIsCorrect(null);
    
    let nextWordStr = '';
    
    if (words.length === 0) {
      setStatus('loading');
      const fetchedWords = await fetchWords(difficulty, usedWords);
      if (fetchedWords.length > 0) {
        nextWordStr = fetchedWords[0];
        setWords(fetchedWords.slice(1));
      }
    } else {
      nextWordStr = words[0];
      setWords(words.slice(1));
    }
    
    if (nextWordStr) {
      setCurrentWord(nextWordStr);
      setUsedWords(prev => new Set(prev).add(nextWordStr));
      setStatus('idle');
      loadTimeoutRef.current = setTimeout(() => {
         speak(nextWordStr);
      }, 400);
      
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [words, difficulty, usedWords, fetchWords, speak]);
  
  const submitWord = (valueOverride?: string) => {
    if (status !== 'idle' || !currentWord) return;
    
    const valToCheck = (valueOverride !== undefined ? valueOverride : input).toUpperCase();
    
    if (valToCheck.length < currentWord.length && valueOverride === undefined) {
      return; 
    }

    const correct = valToCheck === currentWord;
    setIsCorrect(correct);
    setStatus('submitted');
    
    setScore(s => ({
      correct: s.correct + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
      total: s.total + 1
    }));
    
    setStreak(s => [...s, correct].slice(-8));
  };

  const handleSkip = () => {
    if (status !== 'idle') return;
    setIsCorrect(false);
    setStatus('submitted');
    setScore(s => ({ ...s, wrong: s.wrong + 1, total: s.total + 1 }));
    setStreak(s => [...s, false].slice(-8));
  };

  const loadDefinition = async () => {
    if (isDefinitionLoading || definition || !currentWord) return;
    setIsDefinitionLoading(true);
    try {
      if (!window.puter) throw new Error("Puter not loaded");
      const prompt = `Provide the definition for the word "${currentWord}". Output ONLY raw JSON: {"pos": "part of speech abbrev", "meaning": "1 sentence child-friendly meaning"}. NEVER include the word "${currentWord}" in the meaning. Use "____" instead.`;
      const response = await window.puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
      let text = response.message.content.trim();
      text = text.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
      const result = JSON.parse(text);
      if (result.meaning) {
        const regex = new RegExp(currentWord, 'gi');
        result.meaning = result.meaning.replace(regex, '____');
      }
      setDefinition(result);
    } catch (error: any) {
      showToast("Definition Failed", error.message || "Failed to fetch definition.");
    } finally {
      setIsDefinitionLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (val.length <= currentWord.length) {
      setInput(val);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      submitWord();
    }
  };

  const renderConfetti = () => {
    if (status !== 'submitted' || !isCorrect) return null;
    const colors = ['#69f0ae', '#f9d923', '#4fc3f7', '#c084fc'];
    
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-50">
        {Array.from({ length: 40 }).map((_, i) => {
          const color = colors[Math.floor(Math.random() * colors.length)];
          const size = Math.random() * 8 + 6;
          return (
            <motion.div
              key={i}
              initial={{ 
                opacity: 1, 
                y: -20, 
                x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 800) 
              }}
              animate={{ 
                opacity: 0, 
                y: typeof window !== 'undefined' ? window.innerHeight : 800,
                rotate: Math.random() * 360
              }}
              transition={{ duration: Math.random() * 2 + 1.5, ease: "easeOut" }}
              style={{
                position: 'absolute',
                width: size,
                height: size,
                backgroundColor: color,
                borderRadius: Math.random() > 0.5 ? '50%' : '0%'
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full h-[100dvh] bg-[#0f2a1c] flex items-center justify-center p-4 md:p-8 font-nunito overflow-hidden select-none selection:bg-accent-green selection:text-board">
      <Script src="https://js.puter.com/v2/" strategy="afterInteractive" />
      {renderConfetti()}

      <div className="w-full max-w-[1024px] h-full max-h-[800px] bg-[#1a3a2a] border-[8px] md:border-[16px] border-[#4a2e2b] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-5" style={{backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
        
        {/* Header */}
        <div className="h-16 md:h-20 shrink-0 flex items-center justify-between px-4 md:px-8 bg-[#152e22] border-b border-white/10 relative z-10 font-bold">
          <div className="hidden md:flex gap-2">
            <span className="px-3 py-1 bg-[#4fc3f7]/20 text-[#4fc3f7] text-[10px] uppercase tracking-widest rounded border border-[#4fc3f7]/30 flex items-center gap-1"><FastForward className="w-3 h-3"/> Puter AI Words</span>
            <span className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border flex items-center gap-1 transition-colors ${ voiceStatus === 'ready' ? 'bg-[#69f0ae]/20 text-[#69f0ae] border-[#69f0ae]/30' : voiceStatus === 'failed' ? 'bg-[#f9d923]/20 text-[#f9d923] border-[#f9d923]/30' : 'bg-white/10 text-white/50 border-white/20'}`}><Volume2 className={`w-3 h-3 ${voiceStatus === 'loading' ? 'animate-pulse' : ''}`}/>{voiceStatus === 'ready' ? 'Chatterbox AI Voice' : voiceStatus === 'failed' ? 'Kokoro Voice' : 'Loading Voice...'}</span>
            <span className="px-3 py-1 bg-[#c084fc]/20 text-[#c084fc] text-[10px] uppercase tracking-widest rounded border border-[#c084fc]/30 flex items-center gap-1"><HelpCircle className="w-3 h-3"/> Puter Definitions</span>
          </div>
          <div className="flex gap-2 md:hidden">
             <span className="px-2 py-1 bg-[#4fc3f7]/20 text-[#4fc3f7] text-[10px] uppercase tracking-widest rounded border border-[#4fc3f7]/30 flex items-center gap-1"><FastForward className="w-3 h-3"/> AI</span>
             <span className="px-2 py-1 bg-[#69f0ae]/20 text-[#69f0ae] text-[10px] uppercase tracking-widest rounded border border-[#69f0ae]/30 flex items-center gap-1"><Volume2 className="w-3 h-3"/> TTS</span>
          </div>

          <div className="flex items-center gap-4 md:gap-6">
            <div className="text-center flex flex-col items-center">
              <div className="text-[10px] uppercase text-white/50 tracking-tighter leading-none mb-1">Correct</div>
              <div className="text-xl leading-none text-[#69f0ae]">{score.correct}</div>
            </div>
            <div className="text-center flex flex-col items-center">
              <div className="text-[10px] uppercase text-white/50 tracking-tighter leading-none mb-1">Wrong</div>
              <div className="text-xl leading-none text-[#e84545]">{score.wrong}</div>
            </div>
            <div className="text-center flex flex-col items-center">
              <div className="text-[10px] uppercase text-white/50 tracking-tighter leading-none mb-1">Words</div>
              <div className="text-xl leading-none text-[#f9d923]">{score.total}</div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col items-center py-6 px-4 md:py-10 md:px-12 relative z-10 overflow-y-auto">
          
          {/* Top of Main: Difficulty */}
          <div className="flex gap-4 mb-4 shrink-0">
            {(['Easy', 'Normal', 'Hard'] as const).map(diff => (
              <button
                key={diff}
                onClick={() => changeDifficulty(diff)}
                className={`px-4 md:px-6 py-2 font-bold rounded-full transition-colors text-sm md:text-base ${
                  difficulty === diff 
                    ? 'bg-[#69f0ae] text-[#0f2a1c]' 
                    : 'bg-white/5 border border-white/20 text-white hover:bg-white/10'
                }`}
              >
                {diff}
              </button>
            ))}
          </div>

          {/* Middle of Main: Word Display */}
          {status === 'loading' ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 w-full">
              <RefreshCw className="w-8 h-8 animate-spin text-[#4fc3f7]" />
              <p className="text-white/50 font-bold animate-pulse text-xl">Loading New Words...</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center w-full max-w-2xl mt-4">
              
              <div className="flex shrink-0 gap-1 md:gap-3 items-center justify-center mb-4 flex-wrap max-w-full">
                {Array.from({ length: currentWord.length }).map((_, i) => {
                  const char = input[i] || '';
                  let slotColor = 'border-white/20 text-white/30';
                  
                  if (status === 'submitted') {
                    const isCharMatch = char === currentWord[i];
                    slotColor = isCharMatch ? 'border-[#69f0ae] text-[#69f0ae]' : 'border-[#e84545] text-[#e84545]';
                    if (!char) {
                      return (
                        <div key={i} className={`w-8 h-10 sm:w-10 sm:h-12 md:w-14 md:h-18 border-b-4 flex items-center justify-center text-2xl sm:text-3xl md:text-4xl font-fredoka uppercase opacity-50 border-[#e84545] text-[#e84545]`}>
                          {currentWord[i]}
                        </div>
                      );
                    }
                  } else if (char) {
                    slotColor = 'border-white/60 text-white';
                  }

                  return (
                    <div 
                      key={i} 
                      className={`w-8 h-10 sm:w-10 sm:h-12 md:w-14 md:h-18 border-b-4 flex items-center justify-center text-2xl sm:text-3xl md:text-4xl font-fredoka uppercase transition-colors ${slotColor}`}
                    >
                      {char || '_'}
                    </div>
                  );
                })}
              </div>
              
              <div className="text-white/40 uppercase tracking-widest text-sm font-bold mb-6 shrink-0">
                {currentWord.length} letters total
              </div>

              <AnimatePresence mode="popLayout">
                {definition && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, height: 0 }}
                    className="w-full bg-[#c084fc]/10 border border-[#c084fc]/30 p-4 md:p-6 shrink-0 rounded-lg mb-6 shadow-md"
                  >
                    <div className="text-[#c084fc] font-bold text-xs uppercase mb-2">Definition Hint - {definition.pos}</div>
                    <div className="text-white md:text-lg italic leading-relaxed">{definition.meaning}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {status === 'submitted' ? (
                 <motion.div 
                   initial={{ opacity: 0, y: 20 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="flex flex-col items-center gap-6 mt-auto w-full bg-white/5 p-6 md:p-8 rounded-xl border border-white/10"
                 >
                   <h2 className={`font-fredoka text-3xl md:text-4xl flex items-center gap-3 ${isCorrect ? 'text-[#69f0ae]' : 'text-[#e84545]'}`}>
                     {isCorrect ? <><Check className="w-8 h-8" /> Brilliant!</> : <><X className="w-8 h-8" /> Getting Closer!</>}
                   </h2>
                   
                   {!isCorrect && (
                     <p className="text-lg md:text-xl text-white/80 text-center">
                       The correct spelling is <strong className="text-[#f9d923] tracking-widest uppercase font-fredoka">{currentWord}</strong>
                     </p>
                   )}

                   <button
                     onClick={triggerNextWord}
                     className="mt-2 w-full px-10 py-4 bg-[#4fc3f7] text-[#0f2a1c] font-bold rounded-lg text-xl hover:brightness-110 transition-all flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(79,195,247,0.3)]"
                     autoFocus
                   >
                     Next Word <SkipForward className="w-5 h-5"/>
                   </button>
                 </motion.div>
              ) : (
                <div className="w-full flex flex-col gap-4 mt-auto">
                  <div className="flex flex-col md:flex-row gap-2">
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      className="flex-1 w-full bg-black/30 border-2 border-white/20 rounded-lg px-6 py-4 text-2xl font-fredoka text-white outline-none focus:border-[#69f0ae]/50 transition-all text-center md:text-left tracking-widest uppercase"
                      placeholder="TYPE HERE..."
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus
                    />
                    <button
                      onClick={() => submitWord()}
                      disabled={input.length < currentWord.length}
                      className="bg-[#69f0ae] w-full md:w-auto text-[#0f2a1c] px-8 py-4 rounded-lg font-bold text-xl hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Check
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
                    <button 
                      onClick={() => speak(currentWord)}
                      className={`py-3 px-2 rounded-lg font-bold flex items-center justify-center gap-1 sm:gap-2 transition-all ${
                        isSpeaking ? 'bg-[#4fc3f7] text-[#0f2a1c] brightness-110 shadow-[0_0_15px_#4fc3f7]' : 'bg-[#4fc3f7]/10 border-2 border-[#4fc3f7]/50 text-[#4fc3f7] hover:bg-[#4fc3f7] hover:text-[#0f2a1c] hover:border-[#4fc3f7]'
                      }`}
                    >
                      {isSpeaking ? <Volume2 className="animate-pulse w-4 h-4 sm:w-5 sm:h-5 shrink-0" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />}
                      Hear Word
                    </button>

                    <button
                      onClick={loadDefinition}
                      disabled={isDefinitionLoading || !!definition}
                      className={`py-3 px-2 rounded-lg font-bold border-2 flex items-center justify-center gap-1 sm:gap-2 transition-all ${
                        definition ? 'opacity-50 border-white/10 text-white/30 cursor-not-allowed bg-black/20'
                        : isDefinitionLoading ? 'border-[#c084fc]/50 text-[#c084fc]/50 cursor-wait bg-[#c084fc]/5'
                        : 'border-[#c084fc]/50 text-[#c084fc] hover:bg-[#c084fc] hover:text-[#0f2a1c] hover:border-[#c084fc] bg-[#c084fc]/10'
                      }`}
                    >
                      <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                      {isDefinitionLoading ? 'Thinking...' : 'Definition'}
                    </button>
                    
                    <button
                      onClick={handleSkip}
                      className="text-white/40 border-2 border-transparent py-3 flex items-center justify-center gap-1 sm:gap-2 rounded-lg font-bold hover:text-white hover:bg-white/5 transition-colors"
                    >
                      Skip <FastForward className="w-4 h-4 sm:w-5 sm:h-5 shrink-0"/>
                    </button>

                    <button
                      onClick={() => loadNewWordPool(difficulty, usedWords, false)}
                      className="border-2 flex items-center justify-center gap-1 sm:gap-2 border-white/10 text-white/40 py-3 rounded-lg font-bold hover:border-[#f9d923]/50 hover:text-[#f9d923] hover:bg-[#f9d923]/10 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" /> Shuffle
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Bottom Bar: Streak */}
        <div className="h-10 md:h-12 shrink-0 flex items-center justify-center gap-2 md:gap-4 bg-[#152e22] border-t border-white/10 relative z-10 w-full px-4">
          {Array.from({ length: 8 }).map((_, i) => {
             const offset = streak.length > 8 ? streak.length - 8 : 0;
             const isOk = streak[offset + i];
             if (isOk === true) return <div key={i} className="w-3 h-3 rounded-full bg-[#69f0ae] shadow-[0_0_8px_#69f0ae]" />
             if (isOk === false) return <div key={i} className="w-3 h-3 rounded-full bg-[#e84545] shadow-[0_0_8px_#e84545]" />
             return <div key={i} className="w-3 h-3 rounded-full border-2 border-white/20" />
          })}
        </div>

      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 bg-[#2a1a1a] border-2 border-[#e84545] text-white p-4 rounded-xl shadow-[0_10px_40px_rgba(232,69,69,0.2)] z-50 min-w-[300px] flex items-center gap-4"
          >
            <div className="flex-1">
              <h4 className="font-bold text-lg text-[#e84545]">{toast.title}</h4>
              <p className="text-sm opacity-90 text-white/80">{toast.message}</p>
            </div>
            <button 
              onClick={() => setToast(null)}
              className="text-[#e84545]/50 hover:text-[#e84545] transition-colors p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
