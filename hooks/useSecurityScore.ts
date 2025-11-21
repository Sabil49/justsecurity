// hooks/useSecurityScore.ts
import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface SecurityMetrics {
  score: number; // 0-100
  threatLevel: 'critical' | 'high' | 'medium' | 'low' | 'safe';
  threatsDetected: number;
  lastScan?: string;
  issues: string[];
}

export function useSecurityScore() {
  const [metrics, setMetrics] = useState<SecurityMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSecurityScore();

    // Refresh every 5 minutes
    const interval = setInterval(loadSecurityScore, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const loadSecurityScore = async () => {
    try {
      const response = await api.get('/security/score');
      setMetrics(response.data.metrics);
    } catch (error) {
      console.error('[LOAD_SECURITY_SCORE_ERROR]', error);
    } finally {
      setLoading(false);
    }
  };

  return { metrics, loading, refresh: loadSecurityScore };
}