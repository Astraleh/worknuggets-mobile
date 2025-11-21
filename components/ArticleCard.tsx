import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

type Article = {
  id: string | number;
  title: string;
  ai_summary?: string | null;
  summary?: string | null;
  source?: string | null;
  category?: string | null;
};

type ArticleCardProps = {
  article: Article;
};

export default function ArticleCard({ article }: ArticleCardProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: "/article/[id]",
          params: { id: String(article.id) },
        })
      }
    >
      <Text style={styles.title}>{article.title}</Text>

      <Text style={styles.summary} numberOfLines={2}>
        {article.ai_summary || article.summary || "AI summary coming soon…"}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.source}>{article.source}</Text>
        <Text style={styles.category}>{article.category}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: "#FFF",
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 6,
    color: "#111",
  },
  summary: {
    fontSize: 14,
    color: "#444",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  source: {
    fontSize: 12,
    color: "#888",
  },
  category: {
    fontSize: 12,
    fontWeight: "600",
    color: "#555",
  },
});
