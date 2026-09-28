'use client';
import { Suspense, use } from 'react';
import { MatchScreen } from '@/components/match/MatchScreen';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <MatchScreen key={id} id={Number(id)} />
    </Suspense>
  );
}
