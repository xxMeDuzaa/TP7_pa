import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: 'RutaSur · Torre de control',
  description: 'Seguimiento de envíos en tiempo real orientado a eventos',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="barra">
          <Link href="/" className="marca">
            Ruta<span>Sur</span>
          </Link>
          <nav className="nav">
            <Link href="/">Torre de control</Link>
            <Link href="/tracking">Tracking público</Link>
            <Link href="/analitica">Analítica</Link>
            <Link href="/demo">Panel de demo</Link>
          </nav>
        </header>
        <main className="contenido">{children}</main>
      </body>
    </html>
  );
}
