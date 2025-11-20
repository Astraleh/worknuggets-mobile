import { useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { CATEGORY_MAP } from "../../lib/categoryMap";

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export default function ArticleDetail() {
  const params = useLocalSearchParams();
  const id = params.id as string;

  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadArticle = async () => {
    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.log("❌ Error fetching article:", error);
      Alert.alert("Error", "Could not load article.");
      return null;
    }

    if (data) {
      data.category = CATEGORY_MAP[data.category] || data.category;
      setArticle(data);
    }
    return data;
  };

  useEffect(() => {
    let interval: any;

    const init = async () => {
      setLoading(true);
      const art = await loadArticle();

      // If AI summary isn't ready yet, poll DB every few seconds
      if (art && !art.ai_summary) {
        interval = setInterval(async () => {
          const { data } = await supabase
            .from("articles")
            .select("ai_summary")
            .eq("id", id)
            .single();

          if (data?.ai_summary) {
            setArticle((prev: any) => ({
              ...prev,
              ai_summary: data.ai_summary,
            }));
            clearInterval(interval);
          }
        }, 2500);
      }

      setLoading(false);
    };

    init();

    return () => clearInterval(interval);
  }, [id]);

  if (loading && !article) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!article) {
    return (
      <View style={styles.container}>
        <Text style={{ padding: 20 }}>Article not found.</Text>
      </View>
    );
  }

  const summaryText =
    article.ai_summary ||
    "A short AI-powered summary is being generated…";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.tag}>{article.category}</Text>
      <Text style={styles.title}>{article.title}</Text>

      {article.pub_date && (
        <Text style={styles.time}>{timeAgo(article.pub_date)}</Text>
      )}

      <Text style={styles.summary}>{summaryText}</Text>

      <TouchableOpacity
        style={[styles.button, { marginTop: 24 }]}
        onPress={() => Linking.openURL(article.link)}
      >
        <Text style={styles.buttonText}>Read full article →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: "#fff" },
  tag: { fontSize: 14, fontWeight: "600", color: "#4A4A4A", marginBottom: 6 },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 6,
    lineHeight: 32,
  },
  time: { fontSize: 12, color: "#999", marginBottom: 20 },
  summary: { fontSize: 17, lineHeight: 26, color: "#333", marginTop: 8 },
  button: {
    paddingVertical: 14,
    backgroundColor: "#000",
    borderRadius: 10,
  },
  buttonText: {
    textAlign: "center",
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
