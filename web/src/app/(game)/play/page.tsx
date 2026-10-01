import { Suspense } from 'react';
import { Lobby } from '@/components/lobby/Lobby';
import { ClaimAUSDDialog } from '@/components/ClaimAUSDDialog';

export default function Page() {
  return (
    <Suspense>
      <Lobby />
      <ClaimAUSDDialog />
    </Suspense>
  );
}
