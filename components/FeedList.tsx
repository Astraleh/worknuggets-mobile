import { View } from "react-native";
import ArticleCard from "./ArticleCard";

export default function FeedList({ data }: { data: any[] }) {
  return (
    <View>
      {data.map((item) => (
        <ArticleCard key={item.id} item={item} />
      ))}
    </View>
  );
}
