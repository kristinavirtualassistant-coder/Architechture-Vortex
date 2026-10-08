import React, { createContext, useContext } from 'react';

// There is no account system in this app: saved leads and AI chats live in this browser's
// localStorage. `user` is a fixed local workspace profile so existing consumers keep working.
export interface LocalUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface AuthContextType {
  user: LocalUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  saveLeadToCloud: (lead: any) => Promise<string>;
  getCloudSavedLeads: () => Promise<any[]>;
  deleteCloudLead: (leadId: string) => Promise<void>;
  saveChatToCloud: (chatData: any) => Promise<void>;
  getCloudChats: () => Promise<any[]>;
}

const LEADS_KEY = 'vortex.saved_leads';
const CHATS_KEY = 'vortex.ai_chats';
const MAX_CHATS = 50;

const LOCAL_USER: LocalUser = { uid: 'local', email: null, displayName: 'Local workspace', photoURL: null };

const readList = (key: string): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    // Drop malformed entries instead of letting them break consumers
    return parsed.filter((item) => item && typeof item === 'object' && typeof item.id === 'string');
  } catch {
    return [];
  }
};

// Throws when the browser refuses the write (quota exceeded, storage disabled)
const writeList = (key: string, list: any[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn('Could not persist to localStorage:', err);
    throw new Error('Could not save to browser storage. It may be full or disabled.');
  }
};

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const saveLeadToCloud = async (lead: any): Promise<string> => {
    const id = newId();
    writeList(LEADS_KEY, [{ ...lead, id, savedAt: new Date().toISOString() }, ...readList(LEADS_KEY)]);
    return id;
  };

  const getCloudSavedLeads = async (): Promise<any[]> =>
    readList(LEADS_KEY).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

  const deleteCloudLead = async (leadId: string): Promise<void> => {
    writeList(LEADS_KEY, readList(LEADS_KEY).filter((lead) => lead.id !== leadId));
  };

  const saveChatToCloud = async (chatData: any): Promise<void> => {
    const chat = { ...chatData, id: chatData.id ?? newId(), updatedAt: new Date().toISOString() };
    writeList(CHATS_KEY, [chat, ...readList(CHATS_KEY).filter((c) => c.id !== chat.id)].slice(0, MAX_CHATS));
  };

  const getCloudChats = async (): Promise<any[]> =>
    readList(CHATS_KEY).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  return (
    <AuthContext.Provider
      value={{
        user: LOCAL_USER,
        loading: false,
        signInWithGoogle: async () => {},
        signOutUser: async () => {},
        saveLeadToCloud,
        getCloudSavedLeads,
        deleteCloudLead,
        saveChatToCloud,
        getCloudChats,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
