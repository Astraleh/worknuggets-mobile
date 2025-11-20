import { View, ScrollView, StyleSheet, RefreshControl } from "react-native";
import Header from "../components/Header";
import IndustryTabs from "../components/IndustryTabs";
import FeedList from "../components/FeedList";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { CATEGORY_MAP } from "../lib/categoryMap";

export default function HomeScreen() {
  const [category, setCategory] = useState("All");
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchArticles = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("articles")
      .select(
        "id, title, category, source, pub_date, read_time, importance, ai_summary, link"
      )
      .order("pub_date", { ascending: false })
      .limit(40);

    if (error) {
      console.log("Supabase error:", error.message);
      setArticles([]);
    } else {
      const mapped = (data ?? []).map((article) => ({
        ...article,
        // convert backend category (ai-ml, fintech-crypto...) to UI category (AI, Crypto...)
        category: CATEGORY_MAP[article.category] || "Other",
      }));
      setArticles(mapped);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const filtered =
    category === "All"
      ? articles
      : articles.filter((a) => a.category === category);

  return (
    <View style={styles.container}>
      <Header />

      <IndustryTabs onSelect={(c) => setCategory(c)} />

      <ScrollView
        style={styles.feedContainer}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchArticles} />
        }
      >
        <FeedList data={filtered} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  feedContainer: {
    flex: 1,
  },
});
