import { AgoraLogo, EnvioLogo, MeraLogo, MonadLogo, PerplLogo } from './SponsorLogos';

/** Everything Longshort is built on, and what each one does in the game. Monochrome marks on the violet band. */
const TRACKS = [
  { name: 'Monad', Logo: MonadLogo, h: 22, what: 'Trades & settlement' },
  { name: 'Perpl', Logo: PerplLogo, h: 26, what: 'Prices & live trade execution' },
  { name: 'Mera', Logo: MeraLogo, h: 34, what: 'Passkey accounts' },
  { name: 'Agora AUSD', Logo: AgoraLogo, h: 19, what: 'AUSD stakes & payouts' },
  { name: 'Envio', Logo: EnvioLogo, h: 19, what: 'Indexes every match' },
];

export function Tracks() {
  return (
    <section className="lp-tracks" aria-label="Built on">
      <div className="lp-tracks-label">
        <i /> Built on
      </div>
      <div className="lp-tracks-rail">
        <div className="lp-tracks-move">
          {[0, 1, 2].map((k) => (
            <span key={k} className="flex" aria-hidden={k > 0}>
              {TRACKS.map(({ name, Logo, h, what }) => (
                <span key={name} className="lp-track">
                  <span className="lp-track-logo" style={{ height: h }}>
                    <Logo title={name} className="h-full w-auto" />
                  </span>
                  <em>{what}</em>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
