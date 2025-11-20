import { View, ScrollView, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useState } from "react";
import { SIMPLIFIED_CATEGORIES } from "../lib/categoryMap";

export default function IndustryTabs({ onSelect }: { onSelect: (i: string) => void }) {
  const [active, setActive] = useState("All");

  const handleSelect = (item: string) => {
    setActive(item);
    onSelect(item);
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {SIMPLIFIED_CATEGORIES.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.pill, active === item && styles.pillActive]}
            onPress={() => handleSelect(item)}
          >
            <Text
              style={[styles.pillText, active === item && styles.pillTextActive]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 48,
    marginBottom: 4,
  },
  scrollContent: {
    paddingHorizontal: 16,
    alignItems: "center",
  },
  pill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "#f2f2f2",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  pillActive: {
    backgroundColor: "#000",
  },
  pillText: {
    fontSize: 14,
    color: "#000",
    opacity: 0.7,
  },
  pillTextActive: {
    color: "#fff",
    opacity: 1,
    fontWeight: "600",
  },
});
