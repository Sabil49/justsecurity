// app/(tabs)/index.tsx
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [securityScore, setSecurityScore] = useState(95);
  const [threatCount, setThreatCount] = useState(0);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    // Load last scan info, security score, etc.
    // This would query local storage or API
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>AVG AntiVirus</Text>
        {String(subscription?.tier) === 'free' && (
          <TouchableOpacity 
            style={styles.upgradeButton}
            onPress={() => router.push('/subscription' as any)}
          >
            <Text style={styles.upgradeText}>UPGRADE</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Scan Button */}
      <View style={styles.scanContainer}>
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => router.push('/scan' as any)}
        >
          <View style={styles.scanButtonInner}>
            <Text style={styles.scanButtonText}>SCAN NOW</Text>
          </View>
        </TouchableOpacity>
        
        <Text style={styles.scanSubtext}>
          Scan your device for hidden threats
        </Text>
        
        {lastScan && (
          <Text style={styles.lastScanText}>
            Last scan {formatLastScan(lastScan)}
          </Text>
        )}
      </View>

      {/* Feature Cards Grid */}
      <View style={styles.grid}>
        <FeatureCard
          icon="🛡️"
          title="Hack alerts"
          isPremium={false}
          onPress={() => router.push('/hack-alerts' as any)}
        />
        
        <FeatureCard
          icon="🧹"
          title="Clean junk"
          isPremium={false}
          onPress={() => router.push('/clean-junk' as any)}
        />
        
        <FeatureCard
          icon="📶"
          title="Check speed"
          color="#ff4757"
          isPremium={false}
          onPress={() => router.push('/speed-test' as any)}
        />
        
        <FeatureCard
          icon="🔒"
          title="Automatic Scan"
          subtitle="Not activated"
          isPremium={true}
          locked={String(subscription?.tier) === 'free'}
          onPress={() => {
            if (String(subscription?.tier) === 'free') {
              router.push('/subscription' as any);
            } else {
              router.push('/auto-scan' as any);
            }
          }}
        />
      </View>

      {/* Upgrade Prompt for Free Users */}
      {String(subscription?.tier) === 'free' && (
        <View style={styles.upgradePrompt}>
          <Text style={styles.upgradePromptTitle}>
            Done with ads?
          </Text>
          <Text style={styles.upgradePromptText}>
            Upgrade to Premium and stay secured without ad interruption.
          </Text>
          <TouchableOpacity
            style={styles.upgradePromptButton}
            onPress={() => router.push('/subscription' as any)}
          >
            <Text style={styles.upgradePromptButtonText}>UPGRADE</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

interface FeatureCardProps {
  icon: string;
  title: string;
  subtitle?: string;
  color?: string;
  isPremium?: boolean;
  locked?: boolean;
  onPress: () => void;
}

function FeatureCard({ 
  icon, 
  title, 
  subtitle, 
  color, 
  isPremium, 
  locked, 
  onPress 
}: FeatureCardProps) {
  return (
    <TouchableOpacity
      style={[styles.card, color && { backgroundColor: color }]}
      onPress={onPress}
    >
      <View style={styles.cardIcon}>
        <Text style={styles.cardIconText}>{icon}</Text>
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle && (
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      )}
      {locked && (
        <View style={styles.cardLock}>
          <Text>🔒</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function formatLastScan(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2c3e50',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  upgradeButton: {
    backgroundColor: '#f39c12',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  upgradeText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12,
  },
  scanContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  scanButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#34495e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  scanButtonInner: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#2ecc71',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scanSubtext: {
    color: '#2ecc71',
    fontSize: 14,
    marginBottom: 8,
  },
  lastScanText: {
    color: '#95a5a6',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
  },
  card: {
    width: '48%',
    aspectRatio: 1,
    backgroundColor: '#34495e',
    borderRadius: 12,
    padding: 16,
    margin: '1%',
    justifyContent: 'space-between',
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardIconText: {
    fontSize: 24,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: '#95a5a6',
    fontSize: 12,
  },
  cardLock: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  upgradePrompt: {
    backgroundColor: '#34495e',
    margin: 20,
    padding: 20,
    borderRadius: 12,
  },
  upgradePromptTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  upgradePromptText: {
    color: '#bdc3c7',
    fontSize: 14,
    marginBottom: 16,
  },
  upgradePromptButton: {
    backgroundColor: '#2ecc71',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  upgradePromptButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
});