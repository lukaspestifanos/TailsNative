import React, { useEffect, useRef } from "react";
import { StyleSheet, Animated, Easing, Dimensions } from "react-native";
import { Image } from "expo-image";
import { colors } from "../lib/theme";
import { isAppReady, onAppReady } from "../lib/appReady";

const { width: SCREEN_W } = Dimensions.get("window");
const LOGO_SIZE = 120;

interface AnimatedSplashProps {
  onFinish: () => void;
}

export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  // Animation values
  const fadeIn = useRef(new Animated.Value(0)).current;
  const entryScale = useRef(new Animated.Value(0.6)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const exitScale = useRef(new Animated.Value(1)).current;
  const bgOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Phase 1: Logo fades in + scales up (500ms)
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(entryScale, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Phase 2: Tails spin — full rotation with a subtle overshoot (1000ms)
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        // Phase 3: Gentle pulse while waiting for content (loops until ready)
        const pulseAnim = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1.06,
              duration: 600,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 1,
              duration: 600,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        );
        pulseAnim.start();

        // Phase 4: Once content is ready, zoom out and reveal
        const dismiss = () => {
          pulseAnim.stop();
          // Reset pulse to 1 for clean exit
          pulse.setValue(1);

          Animated.parallel([
            // Logo zooms way in
            Animated.timing(exitScale, {
              toValue: 15,
              duration: 600,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
            // Background fades out
            Animated.timing(bgOpacity, {
              toValue: 0,
              duration: 450,
              delay: 150,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            // Logo fades out as it zooms
            Animated.timing(fadeIn, {
              toValue: 0,
              duration: 400,
              delay: 200,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(() => {
            onFinish();
          });
        };

        if (isAppReady()) {
          // Content loaded during the spin — small pause to let spin settle
          setTimeout(dismiss, 300);
        } else {
          onAppReady(dismiss);
        }
      });
    });
  }, []);

  const spinRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Combine all scale animations
  const combinedScale = Animated.multiply(
    Animated.multiply(entryScale, pulse),
    exitScale
  );

  return (
    <Animated.View style={[styles.container, { opacity: bgOpacity }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.logoWrap,
          {
            opacity: fadeIn,
            transform: [
              { scale: combinedScale },
              { rotate: spinRotate },
            ],
          },
        ]}
      >
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          contentFit="contain"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  logoWrap: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
