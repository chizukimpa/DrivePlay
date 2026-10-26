package app.driveplay.mobile;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Formats a raw video file name for the player/notification when the file came
 * from the system picker (local file or Google Drive provider). The library
 * entries already come formatted from the WebView.
 *
 * Examples:
 *   Bleach S04E10 (73) [1920X1080p].mkv -> Bleach S04E10 (73) • Bleach
 *   Jujutsu Kaisen S02E05 (52) [1080p].mkv -> Jujutsu Kaisen S02E05 (52) • Jujutsu Kaisen
 *   Naruto Shippuden E500.mkv -> Naruto Shippuden E500
 */
final class MediaTitle {

    private static final Pattern SEASON_EPISODE = Pattern.compile(
        "(?i)\\bS(?:eason)?\\s*0?(\\d{1,2})\\s*[.\\-_ ]?\\s*"
            + "E(?:p(?:isode)?|pis[oó]dio)?\\s*0?(\\d{1,4})\\b");
    private static final Pattern CROSS = Pattern.compile("(?i)\\b(\\d{1,2})x(\\d{1,4})\\b");
    private static final Pattern EPISODE = Pattern.compile(
        "(?i)\\b(?:Episode|Epis[oó]dio|Ep|E)\\s*\\.?\\s*0?(\\d{1,4})\\b");
    private static final Pattern TRAILING = Pattern.compile(
        "(?:^|[\\s._-])-\\s*0?(\\d{1,4})(?=\\s|$|\\[|\\(|\\.)");
    private static final Pattern ABSOLUTE = Pattern.compile("\\((\\d{1,4})\\)|\\[(\\d{1,4})\\]");
    private static final Pattern BRACKETS = Pattern.compile("\\[[^\\]]*\\]");
    private static final Pattern PARENS = Pattern.compile("\\([^)]*\\)");
    private static final Pattern MEDIA_TAGS = Pattern.compile(
        "(?i)\\b(2160p|1440p|1080p|1080i|720p|576p|480p|360p|4k|8k|uhd|hdr10\\+?|hdr|"
            + "dolby\\s*vision|dovi|sdr|blu-?ray|bd-?rip|br-?rip|bdremux|remux|web-?dl|"
            + "webrip|web-?hd|hdtv|dvd-?rip|dvd|hdrip|camrip|amzn|dsnp|disney\\+?|hmax|atvp|"
            + "appletv|pcok|x264|x265|h\\.?264|h\\.?265|hevc|avc|av1|vp9|10bit|8bit|"
            + "aac(?:\\s*2\\.0)?|ac3|eac3|ddp?5\\.1|dts(?:-hd|[- ]?x)?|truehd|atmos|flac|"
            + "opus|mp3|5\\.1|7\\.1|2\\.0|dual\\s*audio|multi\\s*audio|audio\\s*surround|"
            + "surround|dublado|legendado|temporada|season|epis[oó]dio|episode|ep)\\b");

    private MediaTitle() {}

    static String format(String raw, String folder) {
        String input = raw == null ? "" : raw.trim();
        if (input.isEmpty()) return "Vídeo";
        input = input.replaceAll("\\.[A-Za-z0-9]{2,5}$", "");
        String text = input.replace('_', ' ').replaceAll("\\s+", " ").trim();

        int season = -1;
        int episode = -1;
        int cut = -1;
        Matcher match = SEASON_EPISODE.matcher(text);
        if (match.find()) {
            season = parseInt(match.group(1));
            episode = parseInt(match.group(2));
            cut = match.start();
        } else if ((match = CROSS.matcher(text)).find()) {
            season = parseInt(match.group(1));
            episode = parseInt(match.group(2));
            cut = match.start();
        } else if ((match = EPISODE.matcher(text)).find()) {
            episode = parseInt(match.group(1));
            cut = match.start();
        } else if ((match = TRAILING.matcher(text)).find()) {
            episode = parseInt(match.group(1));
            cut = match.start();
        } else {
            match = Pattern.compile("(?:^|[\\s._-])(\\d{1,4})$").matcher(text);
            if (match.find()) {
                int number = parseInt(match.group(1));
                if (!isResolution(number) && !isYear(number)
                    && text.substring(0, match.start()).trim().length() >= 3) {
                    episode = number;
                    cut = match.start();
                }
            }
        }

        int absolute = -1;
        Matcher abs = ABSOLUTE.matcher(text);
        if (abs.find()) {
            int number = parseInt(abs.group(1) != null ? abs.group(1) : abs.group(2));
            if (number > 0 && !isResolution(number) && !isYear(number)) {
                absolute = number;
            }
        }

        String seriesPart = cut >= 0 ? text.substring(0, cut) : text;
        String series = seriesPart
            .replaceAll(BRACKETS.pattern(), " ")
            .replaceAll(PARENS.pattern(), " ")
            .replaceAll(MEDIA_TAGS.pattern(), " ")
            .replaceAll("[._]+", " ")
            .replaceAll("\\s*[-–—]\\s*", " ")
            .replaceAll("^\\s*\\d{1,3}\\s*[-–—]?\\s+", "")
            .replaceAll("\\s+", " ")
            .replaceAll("^[\\s\\-–—:]+|[\\s\\-–—:]+$", "")
            .trim();
        series = titleCase(series);
        if (series.isEmpty()) series = titleCase(text);

        StringBuilder label = new StringBuilder(series);
        if (season > 0 && episode > 0) {
            label.append(" S").append(pad2(season)).append("E").append(pad2(episode));
            if (absolute > episode) label.append(" (").append(absolute).append(")");
        } else if (episode > 0) {
            label.append(" E").append(pad2(episode));
        }

        String suffix = folder == null ? "" : folder.trim();
        if (suffix.isEmpty()) suffix = series;
        if (!suffix.isEmpty() && !suffix.equalsIgnoreCase(series)) {
            label.append(" • ").append(suffix);
        }
        return label.toString();
    }

    private static boolean isResolution(int value) {
        return value == 360 || value == 480 || value == 576 || value == 720
            || value == 1080 || value == 1440 || value == 2160;
    }

    private static boolean isYear(int value) {
        return value >= 1900 && value <= 2099;
    }

    private static int parseInt(String value) {
        try { return Integer.parseInt(value); } catch (Exception error) { return -1; }
    }

    private static String pad2(int value) {
        return value < 10 ? "0" + value : String.valueOf(value);
    }

    private static String titleCase(String value) {
        if (value == null || value.isEmpty()) return "";
        String lower = value.toLowerCase(new Locale("pt", "BR"));
        StringBuilder result = new StringBuilder(lower.length());
        boolean start = true;
        for (int i = 0; i < lower.length(); i += 1) {
            char c = lower.charAt(i);
            if (start && Character.isLetter(c)) {
                result.append(Character.toUpperCase(c));
                start = false;
            } else {
                result.append(c);
                if (c == ' ' || c == ':' || c == '-' || c == '–') start = true;
            }
        }
        return result.toString();
    }
}
