// components/SecurityScore.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

interface SecurityScoreProps {
  score: number; // 0-100
  size?: number;
  strokeWidth?: number;
}

export function SecurityScore({ 
  score, 
  size = 200, 
  strokeWidth = 8 
}: SecurityScoreProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const getColor = (score: number) => {
    if (score >= 90) return '#2ecc71'; // Green
    if (score >= 70) return '#f39c12'; // Orange
    if (score >= 50) return '#e74c3c'; // Red
    return '#c0392b'; // Dark red
  };

  const color = getColor(score);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={color} stopOpacity="1" />
            <Stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </SvgGradient>
        </Defs>

        {/* Background circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#34495e"
          strokeWidth={strokeWidth}
          fill="none"
        />

        {/* Score circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      {/* Score text */}
      <View style={styles.textContainer}>
        <Text style={styles.scoreText}>{score}</Text>
        <Text style={styles.labelText}>Secure</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
  },
  labelText: {
    fontSize: 14,
    color: '#95a5a6',
    marginTop: 4,
  },
});