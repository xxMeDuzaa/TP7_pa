import TrackingEnVivo from '@/components/TrackingEnVivo';
import { datosTracking } from '@/lib/consultas';

export const dynamic = 'force-dynamic';

export default async function TrackingPublico({ params }) {
  const id = decodeURIComponent(params.id);
  return <TrackingEnVivo inicial={await datosTracking(id)} shipmentId={id} />;
}
