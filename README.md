# Pankti Voice Search — Search by Voice across Gurbani

Recite part of a pankti out loud (or type / paste it, in Gurmukhi or romanized
Punjabi) and get fuzzy ranked matches from all 60,610 panktis across the
1,430 Angs of Sri Guru Granth Sahib Ji — each result with its Ang number,
deep-linking into the [Gurbani Reader](https://karamofficial.github.io/gurbani-reader/).

- Text: Gursevak / Read Gurbani vishraam text, exactly as in the CTC-aligned
  corpus of [gurbani-checker](https://github.com/KaramOfficial/gurbani-checker).
- Matching: IDF-weighted candidates + character-trigram rescue + phonetic
  local-alignment re-rank (Cracker fold, extended with a recitation fold for
  pa-IN ASR drift). Design + Gemini review: `docs/DESIGN.md`.
- Voice: Web Speech API `pa-IN` (Chrome/Android first; typed + romanized
  input are first-class fallbacks).

Live: https://karamofficial.github.io/gurbani-voice-search/
