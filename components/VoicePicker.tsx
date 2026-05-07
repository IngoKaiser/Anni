'use client';

import React from 'react';
import { Volume2, Check } from 'lucide-react';
import type { VoiceOption } from '@/lib/use-speech-synthesis';

interface Props {
  voices: VoiceOption[];
  allVoices: VoiceOption[];
  selectedVoiceId: string | null;
  onSelect: (id: string | null) => void;
  onPreview: (voiceId: string | null) => void;
  primary: string;
}

export default function VoicePicker({
  voices,
  allVoices,
  selectedVoiceId,
  onSelect,
  onPreview,
  primary,
}: Props) {
  const isEmpty = voices.length === 0 && allVoices.length === 0;

  return (
    <div>
      {isEmpty ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
          Stimmen werden geladen… Falls dauerhaft nichts erscheint, unterstützt
          dein Browser keine Sprachausgabe oder es sind keine Stimmen installiert.
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* System-Default Option */}
          <button
            onClick={() => {
              onSelect(null);
              onPreview(null);
            }}
            className="w-full p-3 rounded-2xl border-2 transition flex items-center gap-3 text-left"
            style={{
              borderColor: selectedVoiceId === null ? primary : '#E7E5E4',
              background: selectedVoiceId === null ? `${primary}10` : '#FAFAF9',
            }}
          >
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: selectedVoiceId === null ? primary : '#E7E5E4' }}
            >
              <Volume2 size={14} color={selectedVoiceId === null ? '#FFFFFF' : '#78716C'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-stone-800">System-Standard</p>
              <p className="text-[11px] text-stone-500">Automatisch passende Stimme</p>
            </div>
            {selectedVoiceId === null && <Check size={14} style={{ color: primary }} />}
          </button>

          {/* Verfügbare Stimmen */}
          {voices.map(voice => {
            const isSelected = voice.id === selectedVoiceId;
            return (
              <button
                key={voice.id}
                onClick={() => {
                  onSelect(voice.id);
                  onPreview(voice.id);
                }}
                className="w-full p-3 rounded-2xl border-2 transition flex items-center gap-3 text-left"
                style={{
                  borderColor: isSelected ? primary : '#E7E5E4',
                  background: isSelected ? `${primary}10` : '#FAFAF9',
                }}
              >
                <div
                  className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 text-[11px] font-semibold"
                  style={{
                    background: isSelected ? primary : '#E7E5E4',
                    color: isSelected ? '#FFFFFF' : '#78716C',
                  }}
                >
                  {voice.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-stone-800 truncate">{voice.name}</p>
                  <p className="text-[11px] text-stone-500 truncate">
                    {voice.langLabel}
                    {voice.isLocal && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-stone-200 text-[9px] font-mono text-stone-600">
                        offline
                      </span>
                    )}
                  </p>
                </div>
                {isSelected && <Check size={14} style={{ color: primary }} />}
              </button>
            );
          })}

          {voices.length === 0 && allVoices.length > 0 && (
            <div className="text-[11px] text-stone-500 mt-2 px-1">
              Keine Stimmen für die aktuelle Sprache gefunden. Insgesamt sind {allVoices.length} Stimmen verfügbar — wähle "System-Standard" oder
              installiere weitere Stimmen unter iOS-Einstellungen → Bedienungshilfen → VoiceOver → Sprachausgabe.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
