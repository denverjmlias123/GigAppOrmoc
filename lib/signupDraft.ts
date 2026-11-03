import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SignupDraft {
  displayName: string;
  email: string;
  password: string;
}

const SIGNUP_DRAFT_KEY = 'gigormoc_signup_draft_v1';

let memoryDraft: SignupDraft | null = null;

// Pre-hydrate from persistent storage on startup
void AsyncStorage.getItem(SIGNUP_DRAFT_KEY).then((raw) => {
  if (raw && !memoryDraft) {
    try {
      memoryDraft = JSON.parse(raw);
    } catch {
      // Ignore corrupted draft
    }
  }
}).catch(() => {});

export function setSignupDraft(draft: SignupDraft): void {
  memoryDraft = { ...draft };
  void AsyncStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(memoryDraft)).catch(() => {});
}

export function getSignupDraft(): SignupDraft | null {
  return memoryDraft ? { ...memoryDraft } : null;
}

export function clearSignupDraft(): void {
  memoryDraft = null;
  void AsyncStorage.removeItem(SIGNUP_DRAFT_KEY).catch(() => {});
}
