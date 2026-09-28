CREATE TRIGGER award_daily_xp AFTER INSERT ON claims
BEGIN
  UPDATE users SET xp=xp+10 WHERE id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER award_match_xp AFTER INSERT ON results
WHEN NEW.friendly=0 AND NEW.result IN ('win','loss')
BEGIN
  UPDATE users SET xp=MAX(1000,xp+CASE NEW.result WHEN 'win' THEN 50 ELSE -20 END) WHERE id=NEW.user_id;
END;
