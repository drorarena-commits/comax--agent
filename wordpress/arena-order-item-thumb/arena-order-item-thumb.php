<?php
/**
 * Plugin Name: Arena — תמונת הווריאציה במסך ההזמנה
 * Description: במסך עריכת ההזמנה מציג את תמונת הווריאציה שהוזמנה בפועל (הצבע) במקום תמונת מוצר האב, ומאפשר ללחוץ על התמונה כדי להגדיל אותה.
 * Version: 1.0.0
 * Author: COMAX AGENT
 * Requires Plugins: woocommerce
 *
 * ⚠️ הרקע: באתר פעיל התוסף `arena-parent-display` ("Arena - הצגת מוצר אב"),
 * שמחליף את הפריט בשורת ההזמנה במוצר האב — ולכן גם התמונה שמוצגת היא של
 * האב, לא של הצבע שהלקוח הזמין. הקוד הזה לא מבטל אותו; הוא רץ אחריו
 * (priority 9999) ומחזיר רק את התמונה לווריאציה הנכונה.
 *
 * ⚠️ אותו קובץ בדיוק מתאים גם להדבקה ב-Code Snippets — בלי בלוק ההערה הזה
 * ובלי `<?php`. לכן אין כאן `const` ברמת קובץ ואין `?>` באמצע: שניהם נשברים
 * בתוך ה-eval של Code Snippets, בעוד שקבוע מספרי ו-nowdoc עובדים בשתי הדרכים.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// ⚠️ העטיפה הזאת אינה קישוט: אם הקוד יותקן גם כתוסף וגם כ-snippet, הצהרה
// כפולה של אותה פונקציה היא fatal שמפיל את כל האדמין.
if ( ! function_exists( 'arena_oit_thumbnail' ) ) :

	/**
	 * התמונה של שורת ההזמנה — של הווריאציה שהוזמנה, ועטופה בקישור להגדלה.
	 *
	 * ⚠️ הבדיקה היא `get_post_thumbnail_id` על הווריאציה ולא `$product->get_image()`:
	 * `WC_Product_Variation::get_image()` **נופל בשקט** לתמונת מוצר האב כשלווריאציה
	 * אין תמונה משלה, ולכן "חזרה תמונה" שם אינו אומר שהיא של הצבע הנכון. נמדד
	 * ב-15/09/2026 מול ה-REST: ווריאציה 74648 החזירה בדיוק את קובץ האב.
	 */
	function arena_oit_thumbnail( $thumbnail, $item_id, $item ) {
		if ( ! is_object( $item ) || ! method_exists( $item, 'get_variation_id' ) ) {
			return $thumbnail;
		}

		$variation_id = (int) $item->get_variation_id();
		$product_id   = (int) $item->get_product_id();

		$image_id  = $variation_id ? (int) get_post_thumbnail_id( $variation_id ) : 0;
		$is_actual = $image_id > 0;

		if ( ! $image_id ) {
			$image_id = (int) get_post_thumbnail_id( $product_id );
		}
		if ( ! $image_id ) {
			return $thumbnail; // אין תמונה בכלל — משאירים את מה שהיה
		}

		$img = wp_get_attachment_image(
			$image_id,
			'thumbnail',
			false,
			array(
				'title' => '',
				'alt'   => wp_strip_all_tags( $item->get_name() ),
				'class' => 'arena-oit-img',
			)
		);
		if ( ! $img ) {
			return $thumbnail;
		}

		$full = wp_get_attachment_image_url( $image_id, 'large' );
		if ( ! $full ) {
			$full = wp_get_attachment_image_url( $image_id, 'full' );
		}

		// הכיתוב שמוצג מתחת להגדלה: שם הפריט כולל הצבע והמידה שהוזמנו.
		$caption = wp_strip_all_tags( $item->get_name() );
		if ( ! $is_actual ) {
			$caption .= ' — ⚠ תמונת מוצר האב: לווריאציה הזאת אין תמונה משלה';
		}

		// ⚠️ בלי תכונות data-* : הטמפלייט של WooCommerce מעביר את הפלט דרך
		// `wp_kses_post`, שמסנן data-* ומשאיר href/class/title. לכן הכתובת
		// המלאה יושבת ב-href, וה-JS קורא אותה משם.
		return sprintf(
			'<a href="%1$s" class="arena-oit-zoom%2$s" title="%3$s">%4$s</a>',
			esc_url( $full ),
			$is_actual ? '' : ' arena-oit-parent',
			esc_attr( $caption ),
			$img
		);
	}
	add_filter( 'woocommerce_admin_order_item_thumbnail', 'arena_oit_thumbnail', 9999, 3 );

	/** האם אנחנו במסך ההזמנה — גם בעורך הקלאסי וגם ב-HPOS. */
	function arena_oit_is_order_screen() {
		if ( ! function_exists( 'get_current_screen' ) ) {
			return false;
		}
		$screen = get_current_screen();
		if ( ! $screen ) {
			return false;
		}
		if ( ! empty( $screen->post_type ) && 'shop_order' === $screen->post_type ) {
			return true;
		}
		return ! empty( $screen->id ) && false !== strpos( $screen->id, 'wc-orders' );
	}

	/**
	 * ההגדלה עצמה — CSS ו-JS ללא תלויות, ורק במסך ההזמנה.
	 *
	 * ⚠️ המאזין יושב על `document` ב-delegation ולא על התמונות עצמן, כי
	 * WooCommerce טוען מחדש את טבלת הפריטים ב-AJAX אחרי כל עריכה — מאזין
	 * שנקשר לתמונה מת שם, וההגדלה הייתה מפסיקה לעבוד בלי שום שגיאה.
	 */
	function arena_oit_footer() {
		if ( ! arena_oit_is_order_screen() ) {
			return;
		}

		echo <<<'HTML'
<style id="arena-oit-css">
/* התמונה בשורה — מעט גדולה מ-38px של WooCommerce, כדי שהצבע יהיה קריא בלי לחיצה */
.woocommerce_order_items .wc-order-item-thumbnail { width: 48px; height: 48px; }
.woocommerce_order_items td.thumb { width: 48px; }
.arena-oit-zoom { display: block; cursor: zoom-in; line-height: 0; }
.arena-oit-zoom img { width: 100%; height: auto; border-radius: 3px; }
/* מסגרת כתומה מקווקוות = אין תמונה לווריאציה, ומה שנראה הוא האב */
.arena-oit-zoom.arena-oit-parent img { outline: 2px dashed #d98500; outline-offset: -2px; }
.arena-oit-overlay {
	position: fixed; inset: 0; z-index: 160000; background: rgba(0,0,0,.82);
	display: flex; align-items: center; justify-content: center;
	padding: 24px; cursor: zoom-out;
}
.arena-oit-overlay figure { margin: 0; text-align: center; }
.arena-oit-overlay img { max-width: min(88vw, 900px); max-height: 80vh; background: #fff; border-radius: 4px; }
.arena-oit-overlay figcaption {
	color: #fff; font-size: 14px; margin-top: 12px; direction: rtl; max-width: 88vw;
}
.arena-oit-overlay .arena-oit-close {
	position: absolute; top: 14px; inset-inline-end: 18px; color: #fff;
	font-size: 32px; line-height: 1; background: none; border: 0; cursor: pointer;
}
</style>
<script id="arena-oit-js">
(function () {
	var overlay = null;

	function close() {
		if (overlay) { overlay.remove(); overlay = null; }
	}

	function open(src, caption) {
		close();
		overlay = document.createElement('div');
		overlay.className = 'arena-oit-overlay';

		var btn = document.createElement('button');
		btn.className = 'arena-oit-close';
		btn.type = 'button';
		btn.setAttribute('aria-label', 'סגירה');
		btn.textContent = '×';

		var fig = document.createElement('figure');
		var img = document.createElement('img');
		img.setAttribute('src', src);
		img.setAttribute('alt', caption || '');
		var cap = document.createElement('figcaption');
		cap.textContent = caption || '';

		fig.appendChild(img);
		fig.appendChild(cap);
		overlay.appendChild(btn);
		overlay.appendChild(fig);
		document.body.appendChild(overlay);
	}

	document.addEventListener('click', function (e) {
		var t = e.target;
		if (!t || !t.closest) { return; }
		var link = t.closest('a.arena-oit-zoom');
		if (link) {
			e.preventDefault();
			open(link.getAttribute('href'), link.getAttribute('title'));
			return;
		}
		if (overlay && t.closest('.arena-oit-overlay')) { close(); }
	});

	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') { close(); }
	});
})();
</script>
HTML;
	}
	add_action( 'admin_footer', 'arena_oit_footer' );

endif;
