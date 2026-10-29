import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { OfficerProfile, UserRole } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: OfficerProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    badgeNumber: string,
    jurisdiction: string,
    role: UserRole,
    assignedJurisdiction: string,
    supervisorBadge: string,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
 
const [session, setSession] = useState<Session | null>(null);
const [user, setUser] = useState<User | null>(null);
const [profile, setProfile] = useState<OfficerProfile | null>(null);
const [loading, setLoading] = useState(true);

  const fetchOrCreateProfile = async (currentUser: User): Promise<OfficerProfile | null> => {
    try {
      const { data: prof } = await supabase
        .from('officer_profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (prof) {
        const normalizedRole = (prof.role ? prof.role.toLowerCase() : 'officer') as UserRole;
        return {
          ...prof,
          role: normalizedRole,
        } as OfficerProfile;
      }

      // If no profile row exists, auto-provision one to avoid foreign-key failures
      const meta = currentUser.user_metadata || {};
      const newProfData: OfficerProfile = {
        id: currentUser.id,
        full_name: (meta.full_name as string) || currentUser.email?.split('@')[0] || 'Enforcement Officer',
        badge_number: (meta.badge_number as string) || `LM-${currentUser.id.slice(0, 4).toUpperCase()}`,
        jurisdiction: (meta.jurisdiction as string) || 'Central Division',
        role: ((meta.role as string)?.toLowerCase() === 'supervisor' ? 'supervisor' : 'officer') as UserRole,
        supervisor_id: null,
        assigned_jurisdiction: (meta.assigned_jurisdiction as string) || null,
        created_at: new Date().toISOString(),
      };

      const { data: created, error } = await supabase
        .from('officer_profiles')
        .insert(newProfData)
        .select()
        .single();

      if (!error && created) {
        return created as unknown as OfficerProfile;
      }
      return newProfData;
    } catch (err) {
      console.warn('Error fetching/creating officer profile:', err);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    const prof = await fetchOrCreateProfile(user);
    setProfile(prof);
  };

 
useEffect(() => {
  let isMounted = true;

  const loadSession = async () => {
    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error('Error loading session:', error);
        return;
      }

      if (!isMounted) return;

      const activeSession = data.session;
      const activeUser = activeSession?.user ?? null;

      setSession(activeSession);
      setUser(activeUser);

      if (activeUser) {
        const prof = await fetchOrCreateProfile(activeUser);
        if (isMounted) {
          setProfile(prof);
        }
      } else if (isMounted) {
        setProfile(null);
      }
    } catch (error) {
      console.error('Error initializing authentication:', error);
    } finally {
      if (isMounted) {
        setLoading(false);
      }
    }
  };

  void loadSession();

  const { data: listener } = supabase.auth.onAuthStateChange(
    (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (!newSession?.user) {
        setProfile(null);
        setLoading(false);
      }
    }
  );

  return () => {
    isMounted = false;
    listener.subscription.unsubscribe();
  };
}, []);


  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      const prof = await fetchOrCreateProfile(data.user);
      setProfile(prof);
    }
    return { error: null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    badgeNumber: string,
    jurisdiction: string,
    role: UserRole,
    assignedJurisdiction: string,
    supervisorBadge: string,
  ) => {
    const normalizedRole = role.toLowerCase() as UserRole;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          badge_number: badgeNumber,
          jurisdiction,
          role: normalizedRole,
          assigned_jurisdiction: normalizedRole === 'supervisor' ? assignedJurisdiction : null,
        },
      },
    });

    if (error) return { error: error.message };
    if (data.user) {
      let supervisorId: string | null = null;

      if (normalizedRole === 'officer' && supervisorBadge.trim()) {
        const { data: sup } = await supabase
          .from('officer_profiles')
          .select('id')
          .eq('badge_number', supervisorBadge.trim())
          .maybeSingle();
        if (sup) supervisorId = sup.id;
      }

      const { error: profileError } = await supabase.from('officer_profiles').insert({
        id: data.user.id,
        full_name: fullName,
        badge_number: badgeNumber,
        jurisdiction,
        role: normalizedRole,
        supervisor_id: supervisorId,
        assigned_jurisdiction: normalizedRole === 'supervisor' ? assignedJurisdiction : null,
      });

      if (profileError && !profileError.message.includes('duplicate')) {
        return { error: profileError.message };
      }

      const prof = await fetchOrCreateProfile(data.user);
      setProfile(prof);
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
