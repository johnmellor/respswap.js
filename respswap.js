var respswap = new function() {
    var self = this;

    // The page should call respswap.scanForNewImages() if/when it dynamically
    // adds images to which respswap should apply.
    self.scanForNewImages = function() {
        var urlMap = {};
        var newImages = document.querySelectorAll(".respswap");
        // Batch together reads to avoid unnecessary layouts.
        for (var i = 0; i < newImages.length; i++) {
            var el = newImages[i];
            var data = getImageData(el);
            if (typeof data == "string") {
                logError(data, el);
                continue;
            }
            if (!data)
                continue; // Wait till aspect ratio is available.
            if (!urlMap.hasOwnProperty(data.src))
                urlMap[data.src] = { elems: [], maxWidth: 0 };
            urlMap[data.src].elems.push(el);
            urlMap[data.src].maxWidth = Math.max(data.width, urlMap[data.src].maxWidth);
        }

        // Batch together writes (go ahead and swap out the images).
        for (var src in urlMap) {
            if (!urlMap.hasOwnProperty(src))
                continue;
            swapImage(src, urlMap[src].maxWidth, urlMap[src].elems);
        }
        // Remove respswap class from images that have been processed.
        for (var i = 0; i < newImages.length; i++)
            removeRespswapClass(newImages[i]);
    };

    document.addEventListener("DOMContentLoaded", self.scanForNewImages, false);

    // Munges the image src to include the desired width.
    // Webpages can override this with their own implementation by providing
    // their own definition before this script gets executed, for example:
    //     var respswap = {
    //         appendWidthToSrc: function(src, width) { return src + width; }
    //     }
    var appendWidthToSrc = (respswap && respswap.appendWidthToSrc) || function(src, width) {
        var suffix = '@' + width + 'w';
        var newSrc;
        newSrc = src.replace(/@[0-9]+w/, suffix);
        if (newSrc != src) return newSrc;
        newSrc = src.replace(/\.(?:jpe?g|png|gif|webp)\b)/, suffix + "$&");
        if (newSrc != src) return newSrc;
        return src + suffix;
    };

    function swapImage(src, width, elems) {
        var newSrc = appendWidthToSrc(src, Math.round(width));
        var img = new Image();
        img.onload = function() {
            for (var i = 0; i < elems.length; i++) {
                var el = elems[i];
                if (el.nodeName == "IMG")
                    el.src = newSrc;
                else
                    el.style.setProperty("background-image",
                                         "url('" + newSrc + "')",
                                         "important");
            }
        };
        img.src = newSrc;
    }

    function getImageData(el) {
        var data = {};
        if (el.nodeName == "IMG") {
            // Parse src
            data.src = el.src;

            // Parse width
            data.width = el.getBoundingClientRect().width;
        } else {
            var style = getComputedStyle(el);
            if (isInlineFlow(el)) {
                return "Error: background-image on inline elements isn't supported.";
            }

            // Parse src
            var urlRegex = /^url\(\s*(["'])?(.*)\1\s*\)$/;
            var match = style.backgroundImage.match(urlRegex);
            if (!match)
                return "Error: Couldn't parse background-image. Make sure it is set, and note that only a single url(...) is currently supported.";
            data.src = match[2];

            // Parse width
            var sizeRegex = /^(cover|contain)|(auto|[0-9.]+(?:%|px))(?: (auto|[0-9.]+(?:%|px)))?$/;
            var match = style.backgroundSize.match(sizeRegex);
            if (!match)
                return "Error: Couldn't parse background-size. Make sure it is set, and note that multiple background sizes for multiple backgrounds aren't yet supported.";
            data.width = calculateBackgroundWidth(el, style, data.src, match[1], match[2], match[3]);
            if (typeof data.width != "number")
                return data.width; // Some kind of error
        }
        return data;
    }

    function calculateBackgroundWidth(el, style, src, keyword, width, height) {
        if (width && width != "auto") {
            // This is the easy case, where we don't need to know the intrinsic aspect ratio.
            if (/px$/.test(width))
                return parseFloat(width);
            else // percentage width
                return parseFloat(width) * getSize(el, style).width;
        }

        var elSize = getSize(el, style);
        // Need image aspect-ratio. Check if image is already loaded.
        var img = new Image();
        img.src = src;

        if (img.complete || img.width + img.height > 0) {
            var imgRatio = img.width / img.height;
            if (keyword) { // cover or contain
                var elRatio = elSize.width / elSize.height;
                if (keyword == "cover" && elRatio > imgRatio
                 || keyword == "contain" && elRatio < imgRatio) {
                    return elSize.width;
                } else {
                    return elSize.height * imgRatio;
                }
            } else { // width is auto, hence determined by height
                if (!height || height == "auto")
                    return "Error: background-size must be set to a fixed size (percentages and cover/contain are ok)."
                else if (/px$/.test(height))
                    return parseFloat(height) * imgRatio;
                else // percentage height
                    return parseFloat(height) * elSize.height * imgRatio;
            }
        } else {
            img.onload = function() {
                // TODO: These image won't get shared with other elemens :-(
                var width = calculateBackgroundWidth(el, style, src, keyword, width, height);
                swapImage(src, width, [el]);
            }
            return null;
        }
    }

    // Returns the size of the element's background positioning area.
    function getSize(el, style) {
        if (style.backgroundAttachment == "fixed")
            return { width: window.innerWidth, height: window.innerHeight };
        // TODO: Take into account CSS transforms. This can be done using
        // getBoundingClientRect, which returns the transformed border-box.
        switch (style.backgroundOrigin) {
            case "border-box":
                return { width: el.offsetWidth, height: el.offsetHeight };
            case "padding-box":
            default:
                return { width: el.clientWidth, height: el.clientHeight };
            case "content-box":
                return {
                    width: el.clientWidth - parseFloat(style.paddingLeft)
                                          - parseFloat(style.paddingRight),
                    height: el.clientHeight - parseFloat(style.paddingTop)
                                            - parseFloat(style.paddingBottom)
                };
        }
    }

    function isInlineFlow(style) {
        // This probably has false negatives.
        return style.display == "inline"
            && style.float == "none"
            && /static|relative/.test(style.position);
    }

    function removeRespswapClass(el) {
        el.className = el.className.replace(/\s+respswap|respswap\s*/, "");
    }

    function logError(str, el) {
        if ("console" in window && console.error)
            console.error(str + " Element: " + pathTo(el));
    }

    function pathTo(el) {
        if (el.id)
            return "#" + el.id;
        var name = el.nodeName.toLowerCase();
        if (!el.parentElement || name == "body")
            return name;
        var n = 1;
        for (var p = el.previousElementSibling; p; p = p.previousElementSibling)
            n++;
        return pathTo(el.parentElement) + " > " + name + ":nth-child(" + n + ")";
    }
};