import { Suspense } from 'react';
import LoginScreen from '@/components/LoginScreen';

// Login-Seite ist dynamisch (liest Search-Params), daher kein Static Prerender.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
