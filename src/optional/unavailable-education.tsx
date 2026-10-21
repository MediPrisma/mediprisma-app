'use client'
import { useLanguage } from '@/src/application/providers/language.provider'
export default function UnavailableEducation() {
  const { locale } = useLanguage()
  return <p className="p-4 text-sm text-muted-foreground">{locale === 'en'
    ? 'Personalized education content is not installed in this deployment.'
    : '此部署尚未安裝個人化衛教內容。'}</p>
}
