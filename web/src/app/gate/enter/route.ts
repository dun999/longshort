import { NextResponse } from 'next/server';
import { GATE_COOKIE, gatePassword, gateToken, safeNext, sameSecret } from '@/lib/gate';

export async function POST(req: Request) {
  const form = await req.formData();
  const next = safeNext(String(form.get('next') ?? '/'));
  const pw = gatePassword();
  const given = String(form.get('password') ?? '');
  if (!pw || !sameSecret(gateToken(given), gateToken(pw))) {
    await new Promise((r) => setTimeout(r, 700)); // slows guessing
    return new NextResponse(null, { status: 303, headers: { Location: `/gate?e=1&next=${encodeURIComponent(next)}` } });
  }
  const res = new NextResponse(null, { status: 303, headers: { Location: next } });
  res.cookies.set(GATE_COOKIE, gateToken(pw), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.headers.get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
