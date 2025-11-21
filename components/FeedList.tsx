import { View } from "react-native";
import ArticleCard from "./ArticleCard";

export default function FeedList({ data }: { data: any[] }) {
  return (
    <View>
      {data.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </View>
  );
}
