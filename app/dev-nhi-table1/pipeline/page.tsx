import { notFound } from 'next/navigation'
import PipelineReview from '@/app/dev-nhi-table1/pipeline/PipelineReview'

export default function SyntheticLipidPipelinePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <PipelineReview />
}
