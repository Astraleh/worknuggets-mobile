import { View, Text, StyleSheet } from "react-native";

export default function Header() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>WorkNuggets</Text>
      <Text style={styles.tagline}>Your Daily Industry Intel</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 20,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: "#ffffff",
  },
  logo: {
    fontSize: 28,
    fontWeight: "700",
  },
  tagline: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.6,
  }
});
