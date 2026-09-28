'use client';
import { use } from 'react';
import { Report } from '@/components/match/Report';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Report id={Number(id)} />;
}
