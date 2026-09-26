import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, googleProvider, firestoreDb } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  saveLeadToCloud: (lead: any) => Promise<string>;
  getCloudSavedLeads: () => Promise<any[]>;
  deleteCloudLead: (leadId: string) => Promise<void>;
  saveChatToCloud: (chatData: any) => Promise<void>;
  getCloudChats: () => Promise<any[]>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (currentUser) {
        // Sync user doc to Firestore
        try {
          const userDocRef = doc(firestoreDb, 'users', currentUser.uid);
          await setDoc(
            userDocRef,
            {
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              lastLoginAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (err) {
          console.warn('Could not sync user profile to Firestore:', err);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      // Gracefully handle standard user cancellation / closing popup window
      const errorCode = err?.code || '';
      const errorMessage = err?.message || '';

      if (
        errorCode === 'auth/popup-closed-by-user' ||
        errorCode === 'auth/cancelled-popup-request' ||
        errorCode === 'auth/user-cancelled' ||
        errorMessage.includes('auth/popup-closed-by-user') ||
        errorMessage.includes('auth/cancelled-popup-request')
      ) {
        console.log('ℹ️ Google Sign-in was dismissed by the user.');
        return;
      }

      if (errorCode === 'auth/popup-blocked') {
        console.warn('⚠️ Google Sign-in popup was blocked by browser.');
        return;
      }

      console.warn('Google Sign-in encountered an issue:', errorMessage || err);
    }
  };

  const signOutUser = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign-out failed:', err);
      throw err;
    }
  };

  // Firestore Lead Persistence
  const saveLeadToCloud = async (lead: any): Promise<string> => {
    if (!user) throw new Error('Authentication required to save lead to Firestore');
    const leadsRef = collection(firestoreDb, 'users', user.uid, 'saved_leads');
    const docRef = await addDoc(leadsRef, {
      ...lead,
      savedAt: new Date().toISOString(),
      timestamp: serverTimestamp(),
    });
    return docRef.id;
  };

  const getCloudSavedLeads = async (): Promise<any[]> => {
    if (!user) return [];
    try {
      const leadsRef = collection(firestoreDb, 'users', user.uid, 'saved_leads');
      const q = query(leadsRef, orderBy('savedAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Error fetching leads from Firestore:', err);
      return [];
    }
  };

  const deleteCloudLead = async (leadId: string): Promise<void> => {
    if (!user) return;
    const docRef = doc(firestoreDb, 'users', user.uid, 'saved_leads', leadId);
    await deleteDoc(docRef);
  };

  // AI Chat Persistence
  const saveChatToCloud = async (chatData: any): Promise<void> => {
    if (!user) return;
    try {
      const chatsRef = collection(firestoreDb, 'users', user.uid, 'ai_chats');
      await addDoc(chatsRef, {
        ...chatData,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Error saving chat to Firestore:', err);
    }
  };

  const getCloudChats = async (): Promise<any[]> => {
    if (!user) return [];
    try {
      const chatsRef = collection(firestoreDb, 'users', user.uid, 'ai_chats');
      const q = query(chatsRef, orderBy('updatedAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Error fetching cloud chats:', err);
      return [];
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithGoogle,
        signOutUser,
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
