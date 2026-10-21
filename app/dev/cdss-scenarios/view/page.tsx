import { notFound } from 'next/navigation'
import View from '@/app/dev/cdss-scenarios/view/view'
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <View />
}
