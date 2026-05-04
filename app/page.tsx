import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getTenantById, tenantToPublicView } from '@/lib/tenants';
import VoiceApp from '@/components/VoiceApp';

export default async function HomePage() {
  const session = await auth();

  if (!session?.user || !session.user.tenantId) {
    redirect('/login');
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    redirect('/login');
  }

  return (
    <VoiceApp
      tenant={tenantToPublicView(tenant)}
      user={{
        id: session.user.id || session.user.email!,
        email: session.user.email!,
        name: session.user.name || undefined,
        role: session.user.role,
        isDemoUser: session.user.isDemoUser ?? false,
      }}
    />
  );
}
