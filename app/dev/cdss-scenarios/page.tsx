import { notFound } from 'next/navigation'
import Loader from './loader'
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <Loader />
}
