import s from './IdChip.module.css';

const TINT: Record<string, string> = {
  WI: 'work', ART: 'artifact', WR: 'run', LEASE: 'lease', DEC: 'decision',
  ADR: 'adr', BLK: 'blocker', HG: 'gate', S: 'session',
};
const prefixOf = (id: string) => id.split('-')[0] ?? '';

export function IdChip({ id }: { id: string }) {
  const tint = TINT[prefixOf(id)] ?? 'neutral';
  return <code className={`${s.chip} ${s[`t_${tint}`]}`} title={id}>{id}</code>;
}
