export function Placeholder({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="center">
      <div className="emoji">{icon}</div>
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </div>
  );
}
