// Unit Tests: ID Utilities
import { generateId, generateShortId } from '@/src/shared/utils/id.utils'

describe('ID Utilities', () => {
  describe('generateId', () => {
    it('should generate a valid ID', () => {
      const id = generateId()
      
      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('should generate unique IDs', () => {
      const id1 = generateId()
      const id2 = generateId()
      
      expect(id1).not.toBe(id2)
    })

    it('should use crypto.randomUUID when available', () => {
      // Check if crypto.randomUUID is available (it is in modern Node.js)
      if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        const id = generateId()
        
        // Should be a valid UUID format
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      } else {
        // Skip test if crypto.randomUUID is not available
        expect(true).toBe(true)
      }
    })

    it('should fallback to timestamp-based ID when crypto is unavailable', () => {
      // Mock crypto as undefined
      const originalCrypto = global.crypto
      delete (global as any).crypto

      const id = generateId()
      
      expect(id).toBeDefined()
      expect(id).toContain('-')
      expect(id.split('-')).toHaveLength(2)
      
      global.crypto = originalCrypto
    })

    it('should generate IDs with timestamp component in fallback mode', () => {
      const originalCrypto = global.crypto
      delete (global as any).crypto

      const beforeTime = Date.now()
      const id = generateId()
      const afterTime = Date.now()
      
      const timestamp = parseInt(id.split('-')[0])
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime)
      expect(timestamp).toBeLessThanOrEqual(afterTime)
      
      global.crypto = originalCrypto
    })
  })

  describe('generateShortId', () => {
    it('should generate a short ID', () => {
      const id = generateShortId()
      
      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
      expect(id.length).toBe(8)
    })

    it('should generate unique short IDs', () => {
      const id1 = generateShortId()
      const id2 = generateShortId()
      
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs with alphanumeric characters', () => {
      const id = generateShortId()
      
      expect(id).toMatch(/^[a-z0-9]+$/)
    })

    it('should generate consistent length IDs', () => {
      const ids = Array.from({ length: 10 }, () => generateShortId())
      
      ids.forEach(id => {
        expect(id.length).toBe(8)
      })
    })

    it('should generate different IDs in rapid succession', () => {
      const ids = new Set()
      for (let i = 0; i < 100; i++) {
        ids.add(generateShortId())
      }
      
      // Should have high uniqueness (at least 95% unique)
      expect(ids.size).toBeGreaterThan(95)
    })
  })

  describe('ID format validation', () => {
    it('generateId should not contain spaces', () => {
      const id = generateId()
      expect(id).not.toContain(' ')
    })

    it('generateShortId should not contain spaces', () => {
      const id = generateShortId()
      expect(id).not.toContain(' ')
    })

    it('generateId should not be empty', () => {
      const id = generateId()
      expect(id.trim()).toBe(id)
      expect(id.length).toBeGreaterThan(0)
    })

    it('generateShortId should not be empty', () => {
      const id = generateShortId()
      expect(id.trim()).toBe(id)
      expect(id.length).toBeGreaterThan(0)
    })
  })
})
