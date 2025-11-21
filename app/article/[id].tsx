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
import Constants from "expo-constants";

const SUPABASE_URL =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY;

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
  const [summarizing, setSummarizing] = useState(false);

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

  const callOnDemandSummarizer = async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.log("Missing SUPABASE_URL or SUPABASE_ANON_KEY in config");
      return;
    }

    try {
      setSummarizing(true);

      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/on-demand-summarize-article`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ article_id: id }),
        }
      );

      const json = await resp.json();
      console.log("On-demand summary response:", json);

      if (!resp.ok || json.error) {
        console.log("Summary error:", json.error || "Unknown error");
        return;
      }

      if (json.ai_summary) {
        setArticle((prev: any) =>
          prev ? { ...prev, ai_summary: json.ai_summary } : prev
        );
      }
    } catch (e: any) {
      console.log("On-demand summarize error:", e.message || e);
    } finally {
      setSummarizing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const art = await loadArticle();

      // Normal case: ai_summary is already ready from pipeline.
      // Fallback: if no ai_summary BUT full_content exists, trigger on-demand summarizer once.
      if (art && !art.ai_summary && art.full_content) {
        callOnDemandSummarizer();
      }

      setLoading(false);
    };

    init();
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
    article.summary ||
    "A short AI-powered summary will be available soon.";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.tag}>{article.category}</Text>
      <Text style={styles.title}>{article.title}</Text>

      {article.pub_date && (
        <Text style={styles.time}>{timeAgo(article.pub_date)}</Text>
      )}

      <Text style={styles.summary}>{summaryText}</Text>

      {summarizing && !article.ai_summary && (
        <Text style={styles.subtleInfo}>
          Refining this summary in the background…
        </Text>
      )}

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
  subtleInfo: {
    marginTop: 8,
    fontSize: 12,
    color: "#888",
  },
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
