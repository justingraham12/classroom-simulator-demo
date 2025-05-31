// src/app/providers/AppProvider.tsx
import React from 'react';
import { AuthProvider } from '../../context/AuthContext';
import { AppProvider as AppContextProvider } from '../../context/AppContext';

interface AppProviderProps {
  children: React.ReactNode;
  passedSessionId?: string | null;
}

export const AppProvider: React.FC<AppProviderProps> = ({
  children,
  passedSessionId
}) => {
  return (
    <AuthProvider>
      <AppContextProvider passedSessionId={passedSessionId}>
        {children}
      </AppContextProvider>
    </AuthProvider>
  );
};

export default AppProvider;
