import TorreEnVivo from '@/components/TorreEnVivo';
import { datosTorre } from '@/lib/consultas';

export const dynamic = 'force-dynamic';

// Se renderiza en el servidor con los datos actuales; el componente cliente aplica los cambios en vivo.
export default async function TorreDeControl() {
  const inicial = await datosTorre();
  return <TorreEnVivo inicial={inicial} />;
}
